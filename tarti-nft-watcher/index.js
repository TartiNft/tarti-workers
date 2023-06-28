module.exports = async function (context, myTimer) {
    var timeStamp = new Date().toISOString();
    context.log('JavaScript is running');
    if (myTimer.isPastDue) {
        context.log('late!');
    }

    // on dev this is in local.settings.json
    // on prod it is in Azure app config
    // on test it is in Azure deploy slot config
    context.log('Get environment vars');
    const ethClientUri = process.env["ETH_CLIENT_URL"];
    const newlyMintedTartistUri = process.env["NEW_TARTIST_METADATA_CID"];
    const newlyMintedTartiUri = process.env["NEW_TARTI_METADATA_CID"];

    context.log('Get web3');
    const { Web3 } = require('web3');

    context.log('Connect to ethereum');
    const web3 = new Web3(ethClientUri);

    context.log('Add contract owner wallet');
    web3.eth.accounts.wallet.add(process.env['CONTRACT_OWNER_WALLET_PK']);

    const getContract = async (web3, contractJsonFile) => {
        context.log("get contract: " + contractJsonFile);
        const fs = require('fs');
        const contractJson = JSON.parse(fs.readFileSync(contractJsonFile));

        context.log("get the ethreum network id");
        const netId = await web3.eth.net.getId();

        context.log("get the deployed network info from id: " + netId);
        const deployedNetwork = contractJson.networks[netId];

        context.log(`Instance contract now ${deployedNetwork.address}`);
        return new web3.eth.Contract(
            contractJson.abi,
            deployedNetwork && deployedNetwork.address
        );
    };

    const enqueueTokenEvents = async (web3, contractJsonFile, newTokenUri, queueConnectionString, queueName) => {

        context.log("Getting token contract");
        const tokenToQueueContract = await getContract(web3, contractJsonFile);

        context.log("Getting Tartist contract");
        const tartistContract = await getContract(web3, __dirname + "/contracts/Tartist.json");

        context.log("Getting total supply");
        const totalSupply = parseInt(await tokenToQueueContract.methods.totalSupply().call());
        const queueMessages = [];

        //go back through tokens and find the last one that has not been created yet
        context.log("Find NFTs without metadata");
        const uncreatedMetadatas = [];
        for (let tokenId = totalSupply; tokenId > 0; tokenId--) {
            const tokenUri = await tokenToQueueContract.methods.tokenURI(tokenId).call();
            if (tokenUri != newTokenUri) {
                break;
            }
            queueMessages.push({ body: tokenId.toString() });
            uncreatedMetadatas.push(tokenId);
        }

        context.log("Queue messages");
        const { ServiceBusClient } = require("@azure/service-bus");
        const sbClient = new ServiceBusClient(queueConnectionString);
        const sender = sbClient.createSender(queueName);
        if (queueMessages.length == 0) {
            context.log(`There are no messages to enqueue for ${queueName}`);
            return;
        }
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
        context.log("Update token uri");
        for (let i = 0; i < uncreatedMetadatas.length; i++) {
            //for Tartis we are delegating via Tartists, since the Tartist contract owns the Tarti contract
            await tartistContract.methods.setCreationStarted(uncreatedMetadatas[i], tokenToQueueContract != tartistContract).send({ from: process.env['CONTRACT_OWNER_WALLET_ADDRESS'] })
        }
    };

    context.log('Enqueue Tartist events');
    await enqueueTokenEvents(
        web3, __dirname + "/contracts/Tartist.json",
        newlyMintedTartistUri,
        process.env['TARTIST_QUEUE_CONNECTION_STRING'],
        process.env['TARTIST_QUEUE_NAME']
    );

    context.log('Enqueue Tarti events');
    await enqueueTokenEvents(
        web3, __dirname + "/contracts/Tarti.json",
        newlyMintedTartiUri,
        process.env['TARTI_QUEUE_CONNECTION_STRING'],
        process.env['TARTI_QUEUE_NAME']
    );

    context.log('JavaScript timer trigger function ran!', timeStamp);
};