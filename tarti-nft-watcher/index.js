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

        /**
        We do two things here.
        1) send message to service bus for the TartiWorker to pick up.
        2) mark the nft in a creating state.
        
        The order of the two matters.
        Issues this ordering comment is a reaction to: TARTI-122, TARTI-76, TARTI-124, TARTI-125

        If we send the sb message first and then we fail on sending contract tx, then we end up sending
        out a new service bus message every minute until the tx succeeds. This guarantees creation
        but also causes potential overruns.
        Other hand, if we send contract Tx first and the sb message fails, then the sb message will never be sent
        and the worker never sees it. This means there is a chance the bot/song is never generated,
        but it guarantess no overruns (or at least highly prevents it, without fancy locking).
        We need to mimic a rdb style transaction where we can rollback if *either* fails.
        or at least reduce chances as much as possible.

        Here is what we went with, for now:

        - We will do as much of the SB prep as possible, where most sb exceptions would normally occur.
        - Send the contract Tx
        - Send the Sb message
        
        This reduces the amount of operations that happen between the two, in turn reducing liklihood of exceptions 
        between them. 
        
        @tbd FUTURE (Noted in TARTI-128):
        1. Send the sb message
        2. Send the contract Tx
        3. If the contract tx fails, we can consume the Sb message ourselves, removing it from the queue.
        In addition to this, we will enhance the workers to only operate on messages where the NFT
        is in the `creating` state. So even if a Sb message gets queued, if the contract tx fails then the worker
        will not work on it.
         */

        //Prep the Service Bus message batch
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

        //Set the URI on the queued tokens so that we know they are no longer new.
        //@todo doing synchronous for now.. better to do async and do a waitall or allsettled afterwards, i reckon
        context.log(`Update ${uncreatedMetadatas.length} token uris`);
        const tartistContract = await nft.getContract(__dirname + "/../contracts/Tartist.json");
        for (let i = 0; i < uncreatedMetadatas.length; i++) {
            await nft.sendContractTx(context, tartistContract, "setCreationStarted", [uncreatedMetadatas[i], tokenToQueueContract.options.address != tartistContract.options.address]);
        }

        //Now that the tokens have been put into a "creation started" state,
        //lets publish the message to the Service Bus queue so the workers
        //will see them and start the work.
        //NOTE: If this fails, then we will be in a bad state, because we will have set the state to Creation Started
        //but we didnt start creation. And we will not return here because we already set the state to creating.
        //No concept of "transactions" here between two separate services.
        //So, we need to manually rollback on failure.
        //@tbd TARTI-128
        await sender.sendMessages(batch);
        await sender.close();
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