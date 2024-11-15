async function enqueueWorkForNewTokens() {
    if (!process.env['REDIS_URL'] || !process.env['NEW_TARTIST_METADATA_CID'] || !process.env['NEW_TARTI_METADATA_CID'] || !process.env['TARTIST_QUEUE_NAME'] || !process.env['TARTI_QUEUE_NAME']) {
        throw new Error("Missing required environment variables");
    }

    const redis = require("redis");
    const nft = require("../shared/nft");

    var timeStamp = new Date().toISOString();
    console.log('tarti-nft-watcher is running');

    // on dev this is in local.settings.json
    // on prod it is in Azure app config
    // on test it is in Azure deploy slot config
    const newlyMintedTartistUri = "ipfs://" + process.env["NEW_TARTIST_METADATA_CID"];
    const newlyMintedTartiUri = "ipfs://" + process.env["NEW_TARTI_METADATA_CID"];
    const redisClient = redis.createClient({
        url: process.env['REDIS_URL']
    });

    /**
     * Go backwards from newest token to oldest token and look at each token's URI.
     * (The URI also indicates creation state. Certain URIs = certain states.)
     * If the URI shows the token is newly minted, then
     * - Queue the token for offchain processing
     * - Set the token URI to indicate that the NFT is going to the next state, which is the "creation in progress" state.
     * 
     * If the URI shows the token is not newly minted, then stop iterating back.
     * Otherwise we would go through every single token every time.
     * 
     * This function works with both TARTIs and TARTISTs.
     * 
     * @param {string} contractJsonFile The path to the contract json file that contains the ABI (TARTIST or TARTI contract).
     * @param {string} newTokenUri The URI that indicates a token is new and unprocessed.
     * @param {string} queueName The name of the Redis list to enqueue the NFT creation events onto.
     * @returns 
     */
    const enqueueTokenEvents = async (contractJsonFile, newTokenUri, queueName) => {
        const tokenToQueueContract = await nft.getContract(contractJsonFile);
        const totalSupply = parseInt(await tokenToQueueContract.methods.totalSupply().call());
        const uncreatedMetadatas = [];

        // Go backwards through tokens, finding those that have not been created yet
        for (let tokenId = totalSupply; tokenId > 0; tokenId--) {
            const tokenUri = (await tokenToQueueContract.methods.tokenURI(tokenId).call()).substring(0, newTokenUri.length);
            console.log(`Checking if ${tokenUri} is the same as ${newTokenUri}`);
            if (tokenUri !== newTokenUri) {
                break;
            }
            uncreatedMetadatas.push(tokenId);
        }

        if (uncreatedMetadatas.length === 0) {
            console.log(`There are no messages to enqueue for ${queueName}`);
            return;
        }

        /**
         We do two things here.
        1) send message to Redis for the TartiWorker to pick up.
        2) mark the nft in a creating state.
        
        The order of the two matters.
        Issues this ordering comment is a reaction to: TARTI-122, TARTI-76, TARTI-124, TARTI-125

        If we send the Redis message first and then we fail on sending contract tx, then we end up sending
        out a new service bus message every minute until the tx succeeds. This guarantees creation
        but also causes potential overruns.
        Other hand, if we send contract Tx first and the sb message fails, then the Redis message will never be sent
        and the worker never sees it. This means there is a chance the bot/song is never generated,
        but it guarantess no overruns (or at least highly prevents it, without fancy locking).
        We need to make transactional where we can rollback if *either* fails.
        or at least reduce chances as much as possible.

        Here is what we went with, for now:

        - Send the contract Tx
        - Send the Redis message
                
        @tbd FUTURE (Noted in TARTI-128):
        1. Send the sb message
        2. Send the contract Tx
        3. If the contract tx fails, we can consume the Redis message ourselves, removing it from the queue.
        In addition to this, we will enhance the workers to only operate on messages where the NFT
        is in the `creating` state. So even if a Sb message gets queued, if the contract tx fails then the worker
        will not work on it.
        */
        // Set the URI on the queued tokens so that we know they are no longer new
        console.log(`Update ${uncreatedMetadatas.length} token URIs`);
        console.log(`and Enqueueing ${uncreatedMetadatas.length} tokens to Redis list: ${queueName}`);
        const tartistContract = await nft.getContract(__dirname + "/../shared/contracts/Tartist.json");
        for (let tokenId of uncreatedMetadatas) {
            await nft.sendContractTx(tartistContract, "setCreationStarted", [
                tokenId,
                tokenToQueueContract.options.address !== tartistContract.options.address
            ]);
            await redisClient.rPush(queueName, tokenId.toString());
        }
    };

    await redisClient.connect();
    try {
        console.log('Enqueue Tartist events');
        await enqueueTokenEvents(
            __dirname + "/../shared/contracts/Tartist.json",
            newlyMintedTartistUri,
            process.env['TARTIST_QUEUE_NAME']
        );

        console.log('Enqueue Tarti events');
        await enqueueTokenEvents(
            __dirname + "/../contracts/Tarti.json",
            newlyMintedTartiUri,
            process.env['TARTI_QUEUE_NAME']
        );
    } catch (error) {
        console.error("Error trying to enqueue token events");
    } finally {
        await redisClient.quit();
    }

    console.log('tarti-nft-watcher ran!', timeStamp);
};

module.exports = enqueueWorkForNewTokens;

// Run if invoked directly
if (require.main === module) {
    enqueueWorkForNewTokens();
}