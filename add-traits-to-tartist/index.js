module.exports = async function (context, myTimer) {
  var timeStamp = new Date().toISOString();

  context.info('add-trait-to-tartist is starting...');
  if (myTimer.isPastDue) {
    context.info('Late!');
  }

  context.trace("Loading Tartist contract...");
  const nft = require("../nft");
  const traitio = require("../traithttpclient");
  const contract = await nft.getContract(__dirname + "/../contracts/Tartist.json");

  //get existing traits
  context.trace("Get existing traits...");
  const existingTraitIds = await contract.methods.getAllTraits().call();
  const existingTraits = [];
  for (const existingTraitId of existingTraitIds) {
    const existingTrait = await contract.methods.availableTraits(existingTraitId).call();
    if (existingTrait) existingTraits.push(existingTrait);
  }

  //go through all traits and add any that dont exist already
  context.trace("Go through traits and add new ones...");
  const allTraits = await traitio.getTraitAi("trait_files");
  const latestGasLimit = (await nft.web3.eth.getBlock("latest")).gasLimit;
  let nextTraitId = existingTraits.length + 1;
  for (var i = 0; i < allTraits.length; i++) {
    //get trait props
    const traitProps = await traitio.getTraitAi("needed_birth_values", { trait: allTraits[i] });

    //add to the contract
    context.trace("Add trait to the contract...");
    if (traitProps.length > 1) {
      for (const traitProp of traitProps) {
        const traitAndPropName = `${allTraits[i]}.${traitProp}`;
        if (!existingTraits.includes(traitAndPropName)) {
          await contract.methods.addTrait(nextTraitId, traitAndPropName).send({ gas: latestGasLimit, from: nft.web3.eth.accounts.wallet[0].address });
          nextTraitId++;
        }
      }
    } else if (!existingTraits.includes(allTraits[i])) {
      await contract.methods.addTrait(nextTraitId, allTraits[i]).send({ gas: latestGasLimit, from: nft.web3.eth.accounts.wallet[0].address });
      nextTraitId++;
    }
  };

  context.info('JavaScript timer trigger function ran!', timeStamp);
};