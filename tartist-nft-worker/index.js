module.exports = async function (context, tartistSbMsg) {

    const tokenId = tartistSbMsg;

    //get bot info from the block chain
    const traits = await contract.methods.botTraits(tokenId).call();
    const traitDynValues = await contract.methods.botTraitValues(tokenId).call();
    const botTraitDominances = await contract.methods.botTraitDominances(tokenId).call();

    //generate metadata with some place holders
    const metaAttributes = [];
    metaAttributes.push({
        "trait_type": "birthday",
        "display_type": "date",
        "value": Math.floor(Date.now() / 1000)
    });

    for (let traitIdx = 0; traitIdx < traits.length; traitIdx++) {

        const traitName = await contract.methods.availableTraits(traits[traitIdx]).call();

        if (traitDynValues[traitIdx]) {
            metaAttributes.push({
                "trait_type": traitName,
                "value": traitDynValues[traitIdx]
            });

        } else {
            metaAttributes.push({
                "value": traitName
            });
        }
    }
    metaAttributes.push(
        {
            "trait_type": "Dominance",
            "value": botTraitDominances[traitIdx]
        }
    );

    //create metadata
    const botMetaData = {
        "name": "",
        "description": "",
        "image": "",
        "animation_url": "",
        "background_color": "",
        "attributes": metaAttributes
    }

    const promptBot = async (prompt, metaData) => {
        const axios = require('axios');
        axios.post(`${process.env["TRAIT_HTTP_URI"]}/prompt_bot?prompt=${prompt}`, {
            bot_metadata: metaData
        }).then(function (response) {
            const responseJson = JSON.parse(response);
            return responseJson.BotResponse;
        }).catch(function (error) {
            throw new error(`Error prompting bot: ${error}`);
        });
    };

    //generate Title from Trait API
    botMetaData.name = promptBot("Generate Your Name", botMetaData)[0];


    //generate description
    botMetaData.description = promptBot("Generate Your Description", botMetaData)[0];


    //generate bots fav bg color
    botMetaData.background_color = "FFFFFF";

    //generate Avatar
    const avatarPathsOnBot = promptBot("Get Avatar", botMetaData); //TraitHttpIO will return an IPFS URI
    botMetaData.image = promptBot("Pin Files To Ipfs", botMetaData, { "Files": avatarPathsOnBot })[0]; //TraitHttpIO will return an IPFS URI

    //upload metadata to IPFS usaing PInata
    const pinataSDK = require('@pinata/sdk');
    const pinata = new pinataSDK({ pinataJWTKey: process.env["PINATA_API_KEY"] });
    const authResult = await pinata.testAuthentication();
    //if authResult checkauth
    const pinResponse = await pinata.pinJSONToIPFS(botMetaData);
    const metaDataFileHash = pinResponse.IpfsHash;

    //update the tokenuri on ethereum
    contract.methods.setComplete(tokenId, metaDataFileHash);

    context.log('JavaScript ServiceBus queue trigger function processed message', tartistSbMsg);
};