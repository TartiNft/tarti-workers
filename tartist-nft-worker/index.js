module.exports = async function (context, tartistSbMsg) {
    //Get bot info from the blockchain
    const nft = require("../nft");
    const tartistContract = await nft.getContract(__dirname + "/../contracts/Tartist.json");
    const tokenId = parseInt(tartistSbMsg);
    const traits = await tartistContract.methods.getTraits(tokenId).call();
    const traitDynValues = await tartistContract.methods.getTraitValues(tokenId).call();
    const botTraitDominances = await tartistContract.methods.getTraitDominances(tokenId).call();

    //Generate metadata with some place holders
    const metaAttributes = [];
    metaAttributes.push({
        "trait_type": "birthday",
        "display_type": "date",
        "value": Math.floor(Date.now() / 1000)
    });
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
    const botMetaData = {
        "name": "",
        "description": "",
        "image": "",
        "animation_url": "",
        "background_color": "FFFFFF",
        "attributes": metaAttributes
    }

    //Fill in the metadata, upload it to IPFS, and update the TokeURI with the new metadata URI
    const traitio = require("../traithttpclient");
    try {
        //Use TRAIT AI to generate parts of the new bot
        botMetaData.name = (await traitio.promptBot("GenerateYourName", botMetaData))[0];
        botMetaData.description = (await traitio.promptBot("GenerateYourDescription", botMetaData))[0];
        //@todo would like to pass in the bot description when creating the avatar. Not sure how windows shell will handle the long prompt.
        const avatarPathsOnBot = await traitio.promptBot("GetAvatar", botMetaData); //Will return file path local to the bot
        botMetaData.image = "ipfs://" + (await traitio.promptBot("PinFilesToIpfs", botMetaData, { "Files*": avatarPathsOnBot.join() }))[0]; //TraitHttpIO will return an IPFS CID

        //Pin metadata to IPFS usaing PInata
        const pinataSDK = require('@pinata/sdk');
        const pinata = new pinataSDK({ pinataJWTKey: process.env["PINATA_API_JWT"] });
        const authResult = await pinata.testAuthentication();
        const pinResponse = await pinata.pinJSONToIPFS(botMetaData, {
            pinataMetadata: {
                name: `${botMetaData.name.replace(/[^\x00-\x7F]|\s/g, "-")}-metadata.json`
            }
        });

        //Update the TokenURI for the bot on the TARTIST contract
        const metaDataFileHash = pinResponse.IpfsHash;
        await tartistContract.methods.setCreated(tokenId, nft.web3.utils.fromAscii(metaDataFileHash), false).send({ from: nft.web3.eth.accounts.wallet[0].address });
        context.log(`Metadata hash: ${metaDataFileHash}`);
    } catch (error) {
        context.log(error);
        throw error;
    }

    context.log('JavaScript ServiceBus queue trigger function processed message', tartistSbMsg);
};