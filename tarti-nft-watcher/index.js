async function enqueueWorkForNewTokens() {
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
        url: `redis://${process.env['REDIS_HOST']}:${process.env['REDIS_PORT'] ? process.env['REDIS_PORT'] : 6379}`
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

        // Set the URI on the queued tokens so that we know they are no longer new
        // queue up a job for the worker
        console.log(`Update ${uncreatedMetadatas.length} token URIs`);
        console.log(`and Enqueueing ${uncreatedMetadatas.length} tokens to Redis list: ${queueName}`);
        const tartistContract = await nft.getContract(__dirname + "/../shared/contracts/Tartist.json");
        for (let tokenId of uncreatedMetadatas) {
            const redisTransaction = redisClient.multi();
            try {
                redisTransaction.rPush(queueName, tokenId.toString());
                const txReceipt = await nft.sendContractTx(tartistContract, "setCreationStarted", [
                    tokenId,
                    tokenToQueueContract.options.address !== tartistContract.options.address
                ]);

                if (txReceipt.status === false) {
                    redisTransaction.discard();
                } else {
                    // Commit the transaction if the contract tx is successful
                    redisTransaction.exec((err, res) => {
                        if (err) {
                            console.error('Error executing Redis transaction:', err);
                        } else {
                            console.log('Transaction result:', res);
                        }
                    });
                }
            } catch (err) {
                redisTransaction.discard();
            }
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
            __dirname + "/../shared/contracts/Tarti.json",
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