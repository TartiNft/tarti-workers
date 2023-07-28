module.exports = async function (context, myTimer) {
    var timeStamp = new Date().toISOString();
    context.log('tarti-nft-watcher is running');
    if (myTimer.isPastDue) {
        context.log('late!');
    }

    // on dev this is in local.settings.json
    // on prod it is in Azure app config
    // on test it is in Azure deploy slot config
    const newlyMintedTartistUri = "ipfs://" + process.env["NEW_TARTIST_METADATA_CID"];
    const newlyMintedTartiUri = "ipfs://" + process.env["NEW_TARTI_METADATA_CID"];
    const nft = require("../nft");

    /**
     * Go backwards from newest token to oldest token and look at each token's URI.
     * (The URI also indicates creation state. Certain URIs = certain states.)
     * If the URI shows the token is newly minted, then
     * - Queue the token for offchain processing
     * - Set the token URI to indicate that the NFT is going to the next state, which is the "creation in progress" state.
     * 
     * If the URI shows the token is not newly minted, then stop iterating back.
     * Otherwise we would go through every single token every time.
     * 
     * This function works with both TARTIs and TARTISTs.
     * 
     * @param {string} contractJsonFile The path to the contract json file that contains the ABI (TARTIST or TARTI contract).
     * @param {string} newTokenUri The URI that indicates a token is new and unprocessed.
     * @param {string} queueConnectionString The connection string for the Azure Service Bus.
     * @param {string} queueName The name of the Azure Service Bus Queue to enqueue the NFT creation events onto.
     * @returns 
     */
    const enqueueTokenEvents = async (contractJsonFile, newTokenUri, queueConnectionString, queueName) => {
        const tokenToQueueContract = await nft.getContract(contractJsonFile);
        const totalSupply = parseInt(await tokenToQueueContract.methods.totalSupply().call());
        const queueMessages = [];

        //Go backwards through tokens, finding those that have not been created yet
        const uncreatedMetadatas = [];
        for (let tokenId = totalSupply; tokenId > 0; tokenId--) {
            const tokenUri = (await tokenToQueueContract.methods.tokenURI(tokenId).call()).substring(0, newTokenUri.length);
            context.log(`Checking if ${tokenUri} is the same as ${newTokenUri}`)
            if (tokenUri != newTokenUri) {
                break;
            }
            queueMessages.push({ body: tokenId.toString() });
            uncreatedMetadatas.push(tokenId);
        }

        if (queueMessages.length == 0) {
            context.log(`There are no messages to enqueue for ${queueName}`);
            return;
        }

        //Send the uncreated token messages to the Service Bus Queue.
        const { ServiceBusClient } = require("@azure/service-bus");
        const sbClient = new ServiceBusClient(queueConnectionString);
        const sender = sbClient.createSender(queueName);
        let batch = await sender.createMessageBatch();
        for (let i = 0; i < queueMessages.length; i++) {
            if (!batch.tryAddMessage(queueMessages[i])) {
                // If the message fails to add to the current batch then
                // that means it is full. Send it.
                await sender.sendMessages(batch);

                // Then, create a new batch.
                batch = await sender.createMessageBatch();

                // Now, add the message which failed to be added to the previous batch to this batch.
                if (!batch.tryAddMessage(queueMessages[i])) {
                    // if it still can't be added to the batch, the individual message is probably too big to fit in a batch
                    throw new Error("Message too big to fit in a batch");
                }
            }
        }
        await sender.sendMessages(batch);
        await sender.close();
        //@todo What happens if someone else reads the queued tokens at this moment, before we update the URI? Any concern?

        //Set the URI on the queued tokens so that we know they are no longer new.
        //@todo doing synchronous for now.. better to do async and do a waitall or allsettled afterwards, i reckon
        context.log(`Update ${uncreatedMetadatas.length} token uris`);
        const tartistContract = await nft.getContract(__dirname + "/../contracts/Tartist.json");
        for (let i = 0; i < uncreatedMetadatas.length; i++) {
            await nft.sendContractTx(context, tartistContract, "setCreationStarted", [uncreatedMetadatas[i], tokenToQueueContract.options.address != tartistContract.options.address]);
        }
    };

    context.log('Enqueue Tartist events');
    await enqueueTokenEvents(
        __dirname + "/../contracts/Tartist.json",
        newlyMintedTartistUri,
        process.env['TARTIST_QUEUE_CONNECTION_STRING'],
        process.env['TARTIST_QUEUE_NAME']
    );

    context.log('Enqueue Tarti events');
    await enqueueTokenEvents(
        __dirname + "/../contracts/Tarti.json",
        newlyMintedTartiUri,
        process.env['TARTI_QUEUE_CONNECTION_STRING'],
        process.env['TARTI_QUEUE_NAME']
    );

    context.log('tarti-nft-watcher ran!', timeStamp);
};