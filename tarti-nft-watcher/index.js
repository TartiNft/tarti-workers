module.exports = async function (context, myTimer) {
    var timeStamp = new Date().toISOString();
    context.log('JavaScript is running');
    if (myTimer.isPastDue) {
        context.log('late!');
    }

    // on dev this is in local.settings.json
    // on prod it is in Azure app config
    // on test it is in Azure deploy slot config
    const newlyMintedTartistUri = "ipfs://" + process.env["NEW_TARTIST_METADATA_CID"];
    const newlyMintedTartiUri = "ipfs://" + process.env["NEW_TARTI_METADATA_CID"];

    const nft = require("../nft");
    const enqueueTokenEvents = async (contractJsonFile, newTokenUri, queueConnectionString, queueName) => {
        const tokenToQueueContract = await nft.getContract(contractJsonFile);
        const tartistContract = await nft.getContract(__dirname + "/../contracts/Tartist.json");
        const totalSupply = parseInt(await tokenToQueueContract.methods.totalSupply().call());
        const queueMessages = [];

        //go back through tokens and find the last one that has not been created yet
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
        const { ServiceBusClient } = require("@azure/service-bus");
        const sbClient = new ServiceBusClient(queueConnectionString);
        const sender = sbClient.createSender(queueName);
        let batch = await sender.createMessageBatch();
        for (let i = 0; i < queueMessages.length; i++) {
            if (!batch.tryAddMessage(queueMessages[i])) {
                // if it fails to add the message to the current batch
                // send the current batch as it is full
                await sender.sendMessages(batch);

                // then, create a new batch 
                batch = await sender.createMessageBatch();

                // now, add the message failed to be added to the previous batch to this batch
                if (!batch.tryAddMessage(queueMessages[i])) {
                    // if it still can't be added to the batch, the individual message is probably too big to fit in a batch
                    throw new Error("Message too big to fit in a batch");
                }
            }
        }
        await sender.sendMessages(batch);
        await sender.close();

        //lets mark them on the block chain as being in process
        //doing syncronous for now.. better to do async and do a waitall or allsettled afterwards, i reckon
        context.log(`Update ${uncreatedMetadatas.length} token uris`);
        for (let i = 0; i < uncreatedMetadatas.length; i++) {
            await tartistContract.methods.setCreationStarted(uncreatedMetadatas[i], tokenToQueueContract.options.address != tartistContract.options.address).send({ from: process.env['CONTRACT_OWNER_WALLET_ADDRESS'] })
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

    context.log('JavaScript timer trigger function ran!', timeStamp);
};