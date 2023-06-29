module.exports = async function (context, myTimer) {
    var timeStamp = new Date().toISOString();
    context.log('JavaScript is running');
    if (myTimer.isPastDue) {
        context.log('late!');
    }

    // on dev this is in local.settings.json
    // on prod it is in Azure app config
    // on test it is in Azure deploy slot config
    const ethClientUri = process.env["ETH_CLIENT_URL"];
    const newlyMintedTartistUri = "ipfs://" + process.env["NEW_TARTIST_METADATA_CID"];
    const newlyMintedTartiUri = "ipfs://" + process.env["NEW_TARTI_METADATA_CID"];

    const { Web3 } = require('web3');
    const web3 = new Web3(ethClientUri);
    web3.eth.accounts.wallet.add(process.env['CONTRACT_OWNER_WALLET_PK']);

    const getContract = async (web3, contractJsonFile) => {
        const fs = require('fs');
        const contractJson = JSON.parse(fs.readFileSync(contractJsonFile));
        const netId = await web3.eth.net.getId();
        const deployedNetwork = contractJson.networks[netId];
        return new web3.eth.Contract(
            contractJson.abi,
            deployedNetwork && deployedNetwork.address
        );
    };

    const mintNewTartist = async (web3, contract) => {
        const recipientAddress = process.env['CONTRACT_OWNER_WALLET_ADDRESS']; //ethereum.selectedAddress;
        const traitsBytes = "0x";
        const dynamicTraitValues = ['purpule sdjfsdfhg ghjgghj', 'dfsgdfsg sdf olf ', 'blue', 'sdfg ssdf g sdsdf g', 'dhrtbdrtbdtb'];
        const traitDominance = [75, 75, 75, 75];

        context.log("creating give birth");
        const giveBirthCaller = contract.methods.giveBirth(recipientAddress, traitsBytes, dynamicTraitValues, traitDominance);

        context.log("encoding tx");
        const sendTxData = giveBirthCaller.encodeABI();

        context.log("getting latest block");
        const latestBlock = await web3.eth.getBlock("latest");

        context.log("getting gas latest limit");
        const latestGasLimit = latestBlock.gasLimit;

        context.log("getting gas price");
        const currentGasPrice = await web3.eth.getGasPrice();

        context.log("sending give birth transaction");
        const mintResult = await web3.eth.sendTransaction({
            from: process.env['CONTRACT_OWNER_WALLET_ADDRESS'], //ethereum.selectedAddress,
            to: contract.options.address,
            data: sendTxData,
            gas: latestGasLimit,
            value: Web3.utils.toWei("0.18", "ether"),
        });

        context.log(mintResult);

        context.log("Your Tartist was minted");
    };


    const enqueueTokenEvents = async (web3, contractJsonFile, newTokenUri, queueConnectionString, queueName) => {
        const tokenToQueueContract = await getContract(web3, contractJsonFile);
        const tartistContract = await getContract(web3, __dirname + "/contracts/Tartist.json");
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

    // context.log('Get contract new artist');
    // const tartistContract = await getContract(web3, __dirname + "/contracts/Tartist.json");
    //context.log('Mint new artist');
    //    await mintNewTartist(web3, tartistContract);

    context.log('JavaScript timer trigger function ran!', timeStamp);
};