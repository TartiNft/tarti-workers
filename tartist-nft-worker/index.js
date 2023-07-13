module.exports = async function (context, tartistSbMsg) {

    const { Web3 } = require('web3');
    const ethClientUri = process.env["ETH_CLIENT_URL"];
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

    const tokenId = parseInt(tartistSbMsg);

    //get bot info from the block chain
    const tartistContract = await getContract(web3, __dirname + "/../contracts/Tartist.json");
    const traits = await tartistContract.methods.getTraits(tokenId).call();
    const traitDynValues = await tartistContract.methods.getTraitValues(tokenId).call();
    const botTraitDominances = await tartistContract.methods.getTraitDominances(tokenId).call();

    //generate metadata with some place holders
    const metaAttributes = [];
    metaAttributes.push({
        "trait_type": "birthday",
        "display_type": "date",
        "value": Math.floor(Date.now() / 1000)
    });

    //add default traits
    // metaAttributes.push({ "value": "GenericBotNamer" });
    // metaAttributes.push({ "value": "GenericBotDescriber" });
    // metaAttributes.push({ "value": "OpenApiChatter" });
    // metaAttributes.push({ "value": "AvatarGenerator" });
    // metaAttributes.push({ "value": "ImageGenerator" });
    // metaAttributes.push({ "value": "FileDownloader" });

    for (let traitIdx = 0; traitIdx < traits.length; traitIdx++) {

        const traitName = await tartistContract.methods.availableTraits(traits[traitIdx]).call();

        if (traitDynValues[traitIdx]) {
            metaAttributes.push({
                "trait_type": traitName,
                "value": traitDynValues[traitIdx],
                "dominance": botTraitDominances[traitIdx]
            });

        } else {
            metaAttributes.push({
                "value": traitName,
                "dominance": botTraitDominances[traitIdx]
            });
        }
    }

    //create metadata
    const botMetaData = {
        "name": "",
        "description": "",
        "image": "",
        "animation_url": "",
        "background_color": "",
        "attributes": metaAttributes
    }

    const promptBot = (prompt, metaData, contextParams) => {
        const axios = require('axios');
        let contextParamsQueryString = "";

        for (const param in contextParams) {
            contextParamsQueryString = `&${param}=${contextParams[param]} ${contextParamsQueryString}`;
        }
        return axios.post(`${process.env["TRAIT_HTTP_URI"]}/prompt_bot?prompt=${prompt}${contextParamsQueryString.trim()}`, {
            bot_metadata: metaData
        }).then(function (response) {
            return JSON.parse(response.data.BotResponse.trim());
        });
    };

    try {
        //generate Title from Trait API
        botMetaData.name = (await promptBot("GenerateYourName", botMetaData))[0];
        //generate description
        botMetaData.description = (await promptBot("GenerateYourDescription", botMetaData))[0];
    } catch (error) {

        console.log(error);
        throw error;
    }

    //generate bots fav bg color
    botMetaData.background_color = "FFFFFF";

    //generate Avatar
    try {
        const avatarPathsOnBot = await promptBot("GetAvatar", botMetaData); //Will return file path local to the bot
        botMetaData.image = "ipfs://" + (await promptBot("PinFilesToIpfs", botMetaData, { "Files": avatarPathsOnBot.join() }))[0]; //TraitHttpIO will return an IPFS CID
    } catch (error) {
        console.log(error);
        throw error;
    }

    try {
        //upload metadata to IPFS usaing PInata
        const pinataSDK = require('@pinata/sdk');
        const pinata = new pinataSDK({ pinataJWTKey: process.env["PINATA_API_JWT"] });
        const authResult = await pinata.testAuthentication();
        //if authResult checkauth
        const pinResponse = await pinata.pinJSONToIPFS(botMetaData);
        const metaDataFileHash = pinResponse.IpfsHash;

        //update the tokenuri on ethereum
        tartistContract.methods.setCreated(tokenId, web3.utils.fromAscii(metaDataFileHash), false).send({ from: web3.eth.accounts.wallet[0].address });
        context.log(`Metadata hash: ${metaDataFileHash}`);
    } catch (error) {
        context.log(error);
        throw error;
    }

    context.log('JavaScript ServiceBus queue trigger function processed message', tartistSbMsg);
};