const redis = require("redis");
const config = require("../shared/config");
const redisClient = redis.createClient({
    url: `redis://${config['REDIS_HOST']}:${config['REDIS_PORT'] ? config['REDIS_PORT'] : 6379}`
});
console.log(`Redis Host is: ${config['REDIS_HOST']}`);

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
 */
async function processNextQueuedToken() {

    console.log(`Checking Tarti queue for newly minted token...`);

    //Get smart contract definitions
    const nft = require("../shared/nft");
    const tartistContract = await nft.getContract(__dirname + "/../shared/contracts/Tartist.json");
    const tartiContract = await nft.getContract(__dirname + "/../shared/contracts/Tarti.json");

    console.log('Getting next token...');
    await redisClient.connect();
    try {

        const nextTokenIdString = await redisClient.lIndex(config.TARTI_QUEUE_NAME, 0);
        if (nextTokenIdString === null) return;
        console.log('Tarti Worker processing token', nextTokenIdString);

        //Load the Tartist contract interface

        //Get the Tarti tokenId, needed in several places
        const tokenId = parseInt(nextTokenIdString);

        //Check if this Tarti has already been created. If so, skip.
        const tartiInCreationUri = "ipfs://" + process.env["CREATING_TARTI_METADATA_CID"];
        const tartiTokenUri = (await tartiContract.methods.tokenURI(tokenId).call()).substring(0, tartiInCreationUri.length);
        console.log(`Checking if Tarti ${tartiTokenUri} is in the creating state ${tartiTokenUri} == ${tartiInCreationUri}`)
        if (tartiTokenUri != tartiInCreationUri) {
            // If its not in the creating state then its either still new or someone already created it
            // Either way, nothing we can do with it
            await redisClient.LPOP(config.TARTI_QUEUE_NAME);
            return;
        }

        //If same user is minting too much on testnet for free, then ignore the minting.
        //For now lets just limit each user to a max of 5 total songs.
        //People can obv cheat with more wallets. But just a quick check. 
        //We have a hard check at 50 in the next code block
        const tokenMinter = await tartiContract.methods.ownerOf(tokenId).call();
        const minterTartiCount = await tartiContract.methods.balanceOf(tokenMinter).call();
        if ((tokenMinter != process.env.CONTRACT_OWNER_WALLET_ADDRESS) && nft.usingTestnet() && (minterTartiCount >= 5)) {
            console.log('User has reached their TARTI minting limit on Testnet', tokenId);
            return;
        }

        //Once 50 songs are minted, only owner can mint anymore.
        if (nft.usingTestnet() && ((await tartiContract.methods.totalSupply().call()) >= 50)) {
            console.log('Temporarily, no more TARTIs on Testnet will be created', tokenId);
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
        //@todo should be able to make other art (and for non nft project should be able to do anything)
        console.log("Invoke TraitAI to make a beat...");
        const traitio = require("../shared/traithttpclient");
        let retryCount = 0;
        let beatInfo;
        while (retryCount < 3) {
            try {
                beatInfo = (await traitio.promptBot("MakeBeat", tartistMetadata, { memoryId: `tarti.${tokenId}` }));
            } catch (error) {
                console.log(`Triggering retry ${retryCount}, Could not make beat due to ${error}`);
            }
            if ((typeof beatInfo === 'object') && beatInfo["title"]) {
                break;
            }
        }
        if ((typeof beatInfo !== 'object') || !beatInfo["title"]) {
            throw new Error("Invalid response from Trait AI when trying to make beat: " + beatInfo);
        }

        //Generate Tarti metadata
        console.log(`Store image file on IPFS (${beatInfo["png"]})...`);
        $tracksImageIpfsUri = (await traitio.promptBot("PinFilesToIpfs", tartistMetadata, { "Files*": beatInfo["png"] }))[0];

        console.log("Generate Tarti Metadata...");
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
                    "value": "ipfs://" + $tracksImageIpfsUri
                }
            ]
        }

        //generate an image for this song
        console.log("Generate song image...");
        const songImageFileLocalToTrait = (await traitio.promptBot("GenerateSongImage", tartistMetadata, tartiMetaData, { memoryId: `tartisongimage.${tokenId}` }))[0];
        tartiMetaData.image = "ipfs://" + (await traitio.promptBot("PinFilesToIpfs", tartistMetadata, { "Files*": songImageFileLocalToTrait }))[0]; //TraitHttpIO will return an IPFS CID
        tartiMetaData.animation_url = "ipfs://" + (await traitio.promptBot("PinFilesToIpfs", tartistMetadata, { "Files*": beatInfo["mp3"] }))[0]; //TraitHttpIO will return an IPFS CID
        tartiMetaData.external_url = `http//tartiart.com/tarti/${tokenId}`;

        //Pin Tarti metadata to IPFS usaing Pinata
        console.log("Pin metadata to IPFS...");
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
        console.log("Update Tarti TokenURI on the blockchain...");
        const txReceipt = await nft.sendContractTx(tartistContract, "setCreated", [tokenId, nft.web3.utils.fromAscii(metaDataFileHash), true]);
        if (txReceipt === false || txReceipt.status === false) {
            throw "Blockchain Transaction failed when updating Tarti. Please try again.";
        }

        // actually pop it off the queue once processing succeeds
        console.log(`Complete processing token (${tokenId})...`);
        await redisClient.LPOP(config.TARTI_QUEUE_NAME);
    } catch (err) {
        throw err;
    } finally {
        await redisClient.quit();
    }

    console.log(`Tarti created.`);
};

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

if (require.main === module) {
    processNextQueuedToken().then(() => {
        console.log("Token processed successfully.");
        process.exit(0); // Explicitly exit when work is done
    }).catch((error) => {
        console.error("Error processing token:", error);
        process.exit(1); // Exit with error code on failure
    });
}