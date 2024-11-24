const redis = require("redis");
const config = require("../shared/config");
const redisClient = redis.createClient({
    url: `redis://${config['REDIS_HOST']}:${config['REDIS_PORT'] ? config['REDIS_PORT'] : 6379}`
});
console.log(`Redis Host is: ${config['REDIS_HOST']}`);
async function processNextQueuedToken() {
    const nft = require("../shared/nft");

    console.log('Getting next token...');
    const nextTokenIdString = await redisClient.lIndex(config.TARTIST_QUEUE_NAME, 0);
    if (nextTokenIdString === null) return;
    console.log('Tartist Worker processing token', nextTokenIdString);

    //Load the Tartist contract interface
    const tartistContract = await nft.getContract(__dirname + "/../shared/contracts/Tartist.json");

    //Get the Tartist tokenId, needed in several places
    const tokenId = parseInt(nextTokenIdString);

    //Check if this Tartist has already been created. If so, skip.
    const tartistInCreationUri = "ipfs://" + config["CREATING_TARTIST_METADATA_CID"];
    const tokenUri = (await tartistContract.methods.tokenURI(tokenId).call()).substring(0, tartistInCreationUri.length);
    console.log(`Checking if Tartist ${tokenUri} is in the creating state ${tokenUri} == ${tartistInCreationUri}`)
    if (tokenUri != tartistInCreationUri) {
        // If its not in the creatig state then its either still new or someone already created it
        // Either way, nothing we can do with it
        await redisClient.LPOP(config.TARTIST_QUEUE_NAME);
        return;
    }

    //If same user is minting too much on testnet for free, then ignore the minting.
    //For now lets just limit each user to a max of 6 bots.
    const tokenMinter = await tartistContract.methods.ownerOf(tokenId).call();
    const minterTartistCount = await tartistContract.methods.balanceOf(tokenMinter).call();
    if ((tokenMinter != config.CONTRACT_OWNER_WALLET_ADDRESS) && nft.usingTestnet() && (minterTartistCount >= 6)) {
        console.log('User has reached their TARTIST minting limit on this TestNet', tokenId);
        return;
    }

    //Once 50 bots are minted, only owner can mint anymore.
    if (nft.usingTestnet() && ((await tartistContract.methods.totalSupply().call()) >= 50)) {
        console.log('Temporarily, no more TARTISTs on Testnet will be created', tokenId);
        return;
    }

    //Get bot info from the blockchain
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
            let nftTraitName = traitName;
            if (nftTraitName.substring(0, 3) == "Dyn") nftTraitName = nftTraitName.substring(3);

            metaAttributes.push({
                "trait_type": nftTraitName,
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
    const traitio = require("../shared/traithttpclient");
    try {
        //Use TRAIT AI to generate parts of the new bot
        botMetaData.name = (await traitio.promptBot("GenerateYourName", botMetaData))[0];
        botMetaData.description = (await traitio.promptBot("GenerateYourDescription", botMetaData))[0];
        //@todo would like to pass in the bot description when creating the avatar. Not sure how windows shell will handle the long prompt.
        const avatarPathsOnBot = await traitio.promptBot("GetAvatar", botMetaData); //Will return file path local to the bot
        botMetaData.image = "ipfs://" + (await traitio.promptBot("PinFilesToIpfs", botMetaData, { "Files*": avatarPathsOnBot.join() }))[0]; //TraitHttpIO will return an IPFS CID

        //Pin metadata to IPFS usaing PInata
        const pinataSDK = require('@pinata/sdk');
        const pinata = new pinataSDK({ pinataJWTKey: config["PINATA_API_JWT"] });
        const authResult = await pinata.testAuthentication();
        const pinResponse = await pinata.pinJSONToIPFS(botMetaData, {
            pinataMetadata: {
                name: `${botMetaData.name.replace(/[^\x00-\x7F]|\s/g, "-")}-metadata.json`
            }
        });

        //Update the TokenURI for the bot on the TARTIST contract
        const metaDataFileHash = pinResponse.IpfsHash;
        console.log(`Metadata hash: ${metaDataFileHash}`);

        console.log('Updating NFT State to Created...');
        const txReceipt = await nft.sendContractTx(tartistContract, "setCreated", [tokenId, nft.web3.utils.fromAscii(metaDataFileHash), false]);
        if (txReceipt === false || txReceipt.status === false) {
            throw "Blockchain Transaction failed. Please try again.";
        }

        // actually pop it off the queue once processing succeeds
        await redisClient.LPOP(config.TARTIST_QUEUE_NAME);

    } catch (error) {
        //@tbd send notification that tartist failed to generate
        console.log(error);
        throw error;
    }

    console.log('TartiWorker processed message', tokenId);
};

async function processNextQueuedTokens() {
    await redisClient.connect();
    try {
        if (await redisClient.LLEN(config.TARTIST_QUEUE_NAME) == 0) {
            console.log(`The queue ${config.TARTIST_QUEUE_NAME} is empty`);
        }
        while (await redisClient.LLEN(config.TARTIST_QUEUE_NAME) > 0) {
            await processNextQueuedToken();
        }
    } catch (error) {
        console.log(error);
    } finally {
        await redisClient.quit();
    }
}
module.exports = processNextQueuedTokens;

// Run if invoked directly
if (require.main === module) {
    processNextQueuedTokens().then(() => {
        console.log("All tokens processed successfully.");
        process.exit(0); // Explicitly exit when work is done
    }).catch((error) => {
        console.error("Error processing tokens:", error);
        process.exit(1); // Exit with error code on failure
    });
}