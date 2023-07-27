/**
 * This function will invoke a TraitAI bot to create the TARTI media
 * and make related updates to the blockchain record.
 * 
 * Steps
 * 1. Dequeue Tarti mint events from the service bus
 * 2. Use offchain service to ask bot to create the media
 * 3. Create and pin NFT metadata for Tarti to IPFS
 * 4. Update the TokenURI for the Tarti
 * 
 * @todo First check if the tarti has already been created!
 * 
 * @param {object} context 
 * @param {string} tartiSbMsg 
 */
module.exports = async function (context, tartiSbMsg) {

    context.log(`Processing queued Tarti ${tartiSbMsg}...`);

    //Get smart contract definitions
    const nft = require("../nft");
    const tartistContract = await nft.getContract(__dirname + "/../contracts/Tartist.json");
    const tartiContract = await nft.getContract(__dirname + "/../contracts/Tarti.json");

    //Get the Tarti tokenId, needed in several places
    const tokenId = parseInt(tartiSbMsg);

    //If same user is minting too much on testnet for free, then ignore the minting.
    //For now lets just limit each user to a max of 10 total songs.
    if (nft.usingTestnet() && (await tartiContract.methods.balanceOf(tartiContract.methods.ownerOf(tokenId))) > 10) {
        context.log('User has reached their TARTI minting limit on Testnet', tartiSbMsg);
        return;
    }

    //Get info about the Tartist, which is needed for the next block to generate the beat
    const tartistId = await tartiContract.methods.artCreators(tokenId).call();
    const tartistUrl = convertIpfsToWeb2GatewayUri(await tartistContract.methods.tokenURI(tartistId).call());
    const tartistMetadata = await downloadFileToMemory(tartistUrl);
    if (!tartistMetadata) {
        throw new Error(`Cannot load Tartist ${tartistUrl} to generate Tarti`);
    }

    //Generate beat package by invoking MakeBeat on the specified TARTIST.
    //The response will include most of what we need for the metadata.
    //If the call fails for some reason, its often intermittent (bad key, bad rhythm, etc), so we will try 3 times.
    //@todo consider breaking out the titling, videos, images etc from the actual beat making.
    const traitio = require("../traithttpclient");
    let retryCount = 0;
    let beatInfo;
    while (retryCount < 3) {
        try {
            beatInfo = (await traitio.promptBot("MakeBeat", tartistMetadata));
        } catch (error) {
            context.log(`Triggering retry ${retryCount}, Could not make beat due to ${error}`);
        }
        if ((typeof beatInfo === 'object') && beatInfo["title"]) {
            break;
        }
    }
    if ((typeof beatInfo !== 'object') || !beatInfo["title"]) {
        throw new Error("Invalid response from Trait AI when trying to make beat: " + beatInfo);
    }

    //Generate Tarti metadata
    const tartiMetaData = {
        "name": beatInfo["title"],
        "description": "test description",
        "image": "",
        "animation_url": "", //this will store the mp3? Would be cool if we have a video instead. We kind of do rn.... Ifwe put a video here then the song would go into a custom field or an attribute?
        "background_color": "FFFFFF",
        "attributes": [
            {
                "trait_type": "birthday",
                "display_type": "date",
                "value": Math.floor(Date.now() / 1000)
            },
            {
                "trait_type": "TracksImage",
                "value": "ipfs://" + (await traitio.promptBot("PinFilesToIpfs", tartistMetadata, { "Files*": beatInfo["png"] }))[0]
            }
        ]
    }
    //generate an image for this song
    const songImageFileLocalToTrait = (await traitio.promptBot("GenerateSongImage", tartistMetadata, tartiMetaData))[0];
    tartiMetaData.image = "ipfs://" + (await traitio.promptBot("PinFilesToIpfs", tartistMetadata, { "Files*": songImageFileLocalToTrait }))[0]; //TraitHttpIO will return an IPFS CID
    tartiMetaData.animation_url = "ipfs://" + (await traitio.promptBot("PinFilesToIpfs", tartistMetadata, { "Files*": beatInfo["mp3"] }))[0]; //TraitHttpIO will return an IPFS CID
    tartiMetaData.external_url = `http//tartiart.com/tarti/${tokenId}`;

    //Pin Tarti metadata to IPFS usaing Pinata
    const pinataSDK = require('@pinata/sdk');
    const pinata = new pinataSDK({ pinataJWTKey: process.env["PINATA_API_JWT"] });
    const authResult = await pinata.testAuthentication();
    const pinResponse = await pinata.pinJSONToIPFS(tartiMetaData, {
        pinataMetadata: {
            name: `${tartiMetaData.name.replace(/[^\x00-\x7F]|\s/g, "-")}-metadata.json`
        }
    });
    const metaDataFileHash = pinResponse.IpfsHash;

    //Update the Tarti's TokenURI to be that of the new Metadata
    await tartistContract.methods.setCreated(tokenId, nft.web3.utils.fromAscii(metaDataFileHash), true).send({ from: nft.web3.eth.accounts.wallet[0].address });

    context.log(`Tarti ${tokenId} created, metadata hash: ${metaDataFileHash}`);

    /**
     * Get the resource at the specified url
     * 
     * @param {string} url 
     * @returns {Promise<string>} The contents of the retrived resource
     */
    async function downloadFileToMemory(url) {
        const axios = require('axios');
        const response = await axios.get(url);
        return response.data;
    }

    /**
     * Convert an IPFS URI to a web2 URI using the IPFS_GATEWAY in the environment
     * 
     * @param {string} uri 
     * @returns 
     */
    function convertIpfsToWeb2GatewayUri(uri) {
        if (uri.substring(0, 7) == "ipfs://") {
            uri = `${process.env.IPFS_GATEWAY}/${uri.substring(7)}`;
        }
        return uri;
    }
};
