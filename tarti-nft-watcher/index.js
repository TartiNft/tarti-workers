module.exports = async function (context, myTimer) {
    var timeStamp = new Date().toISOString();

    if (myTimer.isPastDue) {
        context.log('JavaScript is running late!');
    }

    // on dev this is in local.settings.json
    // on prod it is in Azure app config
    // on test it is in Azure deploy slot config
    const ethClientUri = process.env["ETH_CLIENT_URL"];
    const newlyMintedTokenUri = `ipfs://${process.env['NEW_TARTIST_METADATA_CID']}`;
    const tokenInProgressUri = `ipfs://${process.env['CREATING_TARTIST_METADATA_CID']}`;

    const { Web3 } = require('web3');
    const web3 = new Web3(ethClientUri);

    const getContract = async (web3) => {
        const fs = require('fs');
        const contractFileJson = JSON.parse(fs.readFileSync(__dirname + "/contracts/Tartist.json"));
        const netId = await web3.eth.net.getId();
        const deployedNetwork = contractFileJson.networks[netId];
        return new web3.eth.Contract(
            contractFileJson.abi,
            deployedNetwork && deployedNetwork.address
        );
    };

    const latestBlock = await web3.eth.getBlock('latest');;
    const blockNumber = await web3.eth.getBlockNumber();

    const contract = await getContract(web3); //new web3.eth.Contract(contractAbiJson, tartistContractAddress);  //getContract(web3);
    const totalSupply = parseInt(await contract.methods.totalSupply().call());
    const queueMessages = [];

    //go back through tokens and find the last one that has not been created yet
    const uncreatedTartists = [];
    for (let tokenId = totalSupply; tokenId > 0; tokenId--) {
        const tokenUri = await contract.methods.tokenURI(tokenId).call();
        context.log("token uri from contract: " + tokenUri);
        if (tokenUri != newlyMintedTokenUri) {
            break;
        }
        queueMessages.push({ body: tokenId.toString() });
        uncreatedTartists.push(tokenId);
    }

    const serviceBusConnectionString = process.env['SERVICE_BUS_CONNECTION_STRING'];
    const serviceBusQueueName = process.env['SERVICE_BUS_QUEUE_NAME'];
    const { ServiceBusClient } = require("@azure/service-bus");
    const sbClient = new ServiceBusClient(serviceBusConnectionString);
    const sender = sbClient.createSender(serviceBusQueueName);
    if (queueMessages.length == 0) {
        context.log("There are no messages to queue");
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

    console.log("totalSupply: " + totalSupply)
    console.log("latest: " + latestBlock)
    context.log("block: " + blockNumber)
    context.log('JavaScript timer trigger function ran!', timeStamp);
};