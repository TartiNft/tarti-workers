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

  //get existing traits
  context.log("Get existing traits...");
  const existingTraitIds = await contract.methods.getAllTraits().call();
  const existingTraits = [];
  for (const existingTraitId of existingTraitIds) {
    const existingTrait = await contract.methods.availableTraits(existingTraitId).call();
    if (existingTrait) existingTraits.push(existingTrait);
  }

  //go through all traits and add any that dont exist already
  context.log("Get all traits from TraitIO...");
  const allTraits = await traitio.getTraitAi("trait_files");

  context.log("Get gas limit...");
  const latestGasLimit = (await nft.web3.eth.getBlock("latest")).gasLimit;

  context.log("Get next trait id...");
  let nextTraitId = existingTraits.length + 1;

  context.log("Go through traits...");
  for (var i = 0; i < allTraits.length; i++) {
    //get trait props
    const traitProps = await traitio.getTraitAi("needed_birth_values", { trait: allTraits[i] });

    //add to the contract
    context.log(`Add trait to the contract wallet address and dblcheck ${nft.web3.eth.accounts.wallet[0].address}, ${process.env['CONTRACT_OWNER_WALLET_ADDRESS']}...`);
    if (traitProps.length > 1) {
      for (const traitProp of traitProps) {
        const traitAndPropName = `${allTraits[i]}.${traitProp}`;
        if (!existingTraits.includes(traitAndPropName)) {
          context.log(`addTrait and Prop ${nextTraitId} ${traitAndPropName}, gas limit: ${latestGasLimit}`);
          await contract.methods.addTrait(nextTraitId, traitAndPropName).send({ gas: latestGasLimit, from: process.env['CONTRACT_OWNER_WALLET_ADDRESS'] });
          nextTraitId++;
        }
      }
    } else if (!existingTraits.includes(allTraits[i])) {
      context.log(`addTrait ${nextTraitId} ${allTraits[i]}, gas limit: ${latestGasLimit}`);
      await contract.methods.addTrait(nextTraitId, allTraits[i]).send({ gas: latestGasLimit, from: process.env['CONTRACT_OWNER_WALLET_ADDRESS'] });
      nextTraitId++;
    }
  };

  context.log('add-traits-to-tartist ran!', timeStamp);
};