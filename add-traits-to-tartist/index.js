const nft = require("../nft");
const traitio = require("../traithttpclient");

async function addTraitsToTartist() {
  console.log('add-trait-to-tartist is starting...');

  const timeStamp = new Date().toISOString();
  console.log("Timestamp:", timeStamp);

  try {
    console.log("Loading Tartist contract...");
    const contract = await nft.getContract(__dirname + "/../contracts/Tartist.json");

    console.log("Get existing traits...");
    const existingTraitIds = await contract.methods.getAllTraits().call();
    const existingTraits = [];
    for (const existingTraitId of existingTraitIds) {
      const existingTrait = await contract.methods.availableTraits(existingTraitId).call();
      if (existingTrait) existingTraits.push(existingTrait);
    }

    //Go through all traits and add any that dont exist already.
    console.log("Get all traits from TraitIO...");
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

    console.log("Get next trait id...");
    let nextTraitId = existingTraits.length + 1;

    console.log("Go through traits...");
    const traitPairs = [[], []];
    for (var i = 0; i < newTraits.length; i++) {
      traitPairs[0].push(nextTraitId + i);
      traitPairs[1].push(newTraits[i]);
    }
    console.log(`Add ${traitPairs[0].length} traits to contract...`);
    if (traitPairs[0].length > 0) {
      if (await nft.sendContractTx(contract, "addTraits", traitPairs) === false) {
        console.log("Skipped adding traits");
        return;
      }
    }

    console.log('add-traits-to-tartist ran!', timeStamp);
  } catch (error) {
    console.error("Error occurred in add-traits-to-tartist:", error);
  }
}

module.exports = addTraitsToTartist;

// Run if invoked directly
if (require.main === module) {
  addTraitsToTartist();
}