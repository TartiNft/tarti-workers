module.exports = async function (context, myTimer) {
  context.log('add-trait-to-tartist is starting...');

  var timeStamp = new Date().toISOString();
  if (myTimer.isPastDue) {
    context.log('Late!');
  }

  context.log("Loading Tartist contract...");
  const nft = require("../nft");
  const traitio = require("../traithttpclient");
  const contract = await nft.getContract(__dirname + "/../contracts/Tartist.json");

  context.log("Get existing traits...");
  const existingTraitIds = await contract.methods.getAllTraits().call();
  const existingTraits = [];
  for (const existingTraitId of existingTraitIds) {
    const existingTrait = await contract.methods.availableTraits(existingTraitId).call();
    if (existingTrait) existingTraits.push(existingTrait);
  }

  //Go through all traits and add any that dont exist already.
  context.log("Get all traits from TraitIO...");
  const allTraits = await traitio.getTraitAi("trait_files");

  //Make a list of traits that havent been added yet
  const newTraits = [];
  for (var i = 0; i < allTraits.length; i++) {
    const traitProps = await traitio.getTraitAi("needed_birth_values", { trait: allTraits[i] });
    if (traitProps.length > 1) {
      for (const traitProp of traitProps) {
        const traitAndPropName = `${allTraits[i]}.${traitProp}`;
        if (!existingTraits.includes(traitAndPropName)) {
          newTraits.push(traitAndPropName);
        }
      }
    } else if (!existingTraits.includes(allTraits[i])) {
      newTraits.push(allTraits[i]);
    }
  }

  context.log("Get next trait id...");
  let nextTraitId = existingTraits.length + 1;

  context.log("Go through traits...");
  //Only do up to ten traits per invocation
  for (var i = 0; i < Math.min(newTraits.length, 10); i++) {
    //Add to the contract
    context.log(`Add trait ${newTraits[i]} to the contract wallet address and dblcheck ${nft.web3.eth.accounts.wallet[0].address}, ${process.env['CONTRACT_OWNER_WALLET_ADDRESS']}...`);
    if (await nft.sendContractTx(context, contract, "addTrait", [nextTraitId, newTraits[i]]) === false) {
      context.log("Skipped adding traits");
      return;
    }
    nextTraitId++;
  };

  context.log('add-traits-to-tartist ran!', timeStamp);
};