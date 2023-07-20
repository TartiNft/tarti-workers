# tarti-workers

Tarti workers is an Azure Function App that acts as an interface and broker between the [Tarti contracts](https://github.com/TartiNft/tarti) on Ethereum and the [TraitAI Engine](https://github.com/TartiNft/beatmaker), which lives on a Windows server.

## tarti-nft-watcher

Watches for TARTST and TARTI tokens to be minted. When they are minted, puts a message on a Service Bus Queue notifying the system of the event.

## tartist-nft-worker

Listens for TARTIST mint messages on the Service Bus Queue. When new TARTIST tokens are minted, this worker will communicate with TraitAI to give birth to the bot.

## tarti-nft-worker

Listens for TARTI mint messages on the Service Bus Queue. When new TARTI tokens are minted, this worker will communicate with TraitAI to prompt the correct Tartist to do the work needed to create the media/art for the related TARTI.

## add-traits-to-tartist

Runs on a schedule. Asks TraitAI if it has any new Traits avaiable and if so, adds them to the TARTIST contract for use on future bots. 
