module.exports = async function (context, tartiSbMsg) {
    const nft = require("../nft");
    const tokenId = parseInt(tartiSbMsg);
    const tartistContract = await nft.getContract(__dirname + "/../contracts/Tartist.json");
    const tartiContract = await nft.getContract(__dirname + "/../contracts/Tarti.json");

    //get info about the artist
    const tartistId = await tartiContract.methods.artCreators(tokenId).call();
    const tartistUrl = convertIpfsToWeb2GatewayUri(await tartistContract.methods.tokenURI(tartistId).call());
    const tartistMetadata = await downloadFileToMemory(tartistUrl);

    if (!tartistMetadata) {
        throw new Error("Cannot load Tartist to generate Tarti");
    }
    //@todo check if the tarti has already been created!

    //generate metadata with some place holders
    const metaAttributes = [];
    metaAttributes.push({
        "trait_type": "birthday",
        "display_type": "date",
        "value": Math.floor(Date.now() / 1000)
    });

    //wrting this here for reference need to move this elsewhere post-mint
    //find others..
    //also be cool to add urls for the track images and the tracked out wavs or the zip package
    metaAttributes.push({
        "trait_type": "Key",
        "value": "C#"
    });
    metaAttributes.push({
        "trait_type": "Tempo",
        "value": 125.56
    });
    metaAttributes.push({
        "trait_type": "Created by",
        "value": "Name of the Tartist"
    });
    metaAttributes.push({
        "trait_type": "Tartist Traits",
        "value": "MusicProducer, ArpegioHats, etc"
    });

    //create metadata
    const tartiMetaData = {
        "name": "",
        "description": "",
        "image": "",
        "animation_url": "", //this will store the mp3? Would be cool if we have a video instead. We kind of do rn.... Ifwe put a video here then the song would go into a custom field or an attribute?
        "background_color": "",
        "attributes": metaAttributes
    }

    const traitio = require("../traithttpclient");

    try {
        //generate beat package from MakeBeat which includes most of what we need from Trait API
        //@todo consider breaking out the titling, videos, images etc from the actual beat making.
        const beatInfo = (await traitio.promptBot("MakeBeat", tartistMetadata));

        tartiMetaData.name = beatInfo["title"];
        const mp3PathOnBot = beatInfo["mp3"];
        const tracksImagePathOnBot = beatInfo["png"];
        tartiMetaData.image = "ipfs://" + (await traitio.promptBot("PinFilesToIpfs", tartistMetadata, { "Files": tracksImagePathOnBot }))[0]; //TraitHttpIO will return an IPFS CID
        tartiMetaData.animation_url = "ipfs://" + (await traitio.promptBot("PinFilesToIpfs", tartistMetadata, { "Files": mp3PathOnBot }))[0]; //TraitHttpIO will return an IPFS CID
        tartiMetaData.external_url = `http//tartiart.com/tarti/${tokenId}`;

        //generate description
        tartiMetaData.description = "test description";  //(await traitio.promptBot("GenerateSongDescription", tartistMetadata))[0];
    } catch (error) {

        console.log(error);
        throw error;
    }

    //generate bots fav bg color
    tartiMetaData.background_color = "FFFFFF";

    try {
        //upload metadata to IPFS usaing PInata
        const pinataSDK = require('@pinata/sdk');
        const pinata = new pinataSDK({ pinataJWTKey: process.env["PINATA_API_JWT"] });
        const authResult = await pinata.testAuthentication();
        //if authResult checkauth
        const pinResponse = await pinata.pinJSONToIPFS(tartiMetaData, {
            pinataMetadata: {
                name: `${tartiMetaData.name.replace(/[^\x00-\x7F]|\s/g, "-")}-metadata.json`
            }
        });
        const metaDataFileHash = pinResponse.IpfsHash;

        //update the tokenuri on ethereum
        tartistContract.methods.setCreated(tokenId, nft.web3.utils.fromAscii(metaDataFileHash), true).send({ from: nft.web3.eth.accounts.wallet[0].address });
        context.log(`New tarti metadata hash: ${metaDataFileHash}`);
    } catch (error) {
        context.log(error);
        throw error;
    }

    context.log('JavaScript ServiceBus queue trigger function processed message', tartiSbMsg);
};

async function downloadFileToMemory(url) {
    const axios = require('axios');
    const response = await axios.get(url);
    return response.data;
}

function convertIpfsToWeb2GatewayUri(uri) {
    if (uri.substr(0, 7) == "ipfs://") {
        uri = `${process.env.IPFS_GATEWAY}/${uri.substr(7)}`;
    }
    return uri;
}