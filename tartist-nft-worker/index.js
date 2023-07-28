module.exports = async function (context, tartistSbMsg) {

    context.log('TartiWorker received message', tartistSbMsg);

    //Load the Tartist contract interface
    const nft = require("../nft");
    const tartistContract = await nft.getContract(__dirname + "/../contracts/Tartist.json");

    //If same user is minting too much on testnet for free, then ignore the minting.
    //For now lets just limit each user to a max of 6 bots.
    if (nft.usingTestnet() && (await tartistContract.methods.balanceOf(tartistContract.methods.ownerOf(tokenId))) >= 6) {
        context.log('User has reached their TARTIST minting limit on Testnet', tartistSbMsg);
        return;
    }

    //Once 50 bots are minted, only owner can mint anymore.
    if (nft.usingTestnet() && (await tartistContract.methods.totalSupply() >= 50)) {
        context.log('Temporarily, no more TARTISTs on Testnet will be created', tartistSbMsg);
        return;
    }


    //Get bot info from the blockchain
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
        await nft.sendContractTx(context, tartistContract, "setCreated", [tokenId, nft.web3.utils.fromAscii(metaDataFileHash), false]);
        context.log(`Metadata hash: ${metaDataFileHash}`);
    } catch (error) {
        context.log(error);
        throw error;
    }

    context.log('TartiWorker processed message', tartistSbMsg);
};