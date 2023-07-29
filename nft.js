let web3;
const { Web3 } = require('web3');
const ethClientUri = process.env["ETH_CLIENT_URL"];
web3 = new Web3(ethClientUri);
web3.eth.accounts.wallet.add(process.env['CONTRACT_OWNER_WALLET_PK']);
web3.eth.defaultAccount = process.env['CONTRACT_OWNER_WALLET_ADDRESS'];

const getContract = async (contractJsonFile) => {
    const fs = require('fs');
    const contractJson = JSON.parse(fs.readFileSync(contractJsonFile));
    const netId = await web3.eth.net.getId();
    const deployedNetwork = contractJson.networks[netId];
    return new web3.eth.Contract(
        contractJson.abi,
        deployedNetwork && deployedNetwork.address,
        {
            from: process.env['CONTRACT_OWNER_WALLET_ADDRESS']
        }
    );
};

const usingTestnet = async () => {
    return (await web3.eth.net.getId()) !== 1;
};

const sendContractTx = async (context, contract, methodName, methodArgs) => {
    var latestblock = await web3.eth.getBlock("latest");
    const threeGwei = web3.utils.toWei(3, "gwei");
    const eightGwei = web3.utils.toWei(8, "gwei");
    const bigZero = web3.utils.toBigInt(0);
    const bigTwo = web3.utils.toBigInt(2);
    const bigTen = web3.utils.toBigInt(10);
    const feeHistory = await web3.eth.getFeeHistory(4, "safe", [25, 50, 75]);
    const midTipSum = feeHistory.reward.reduce((accumulated, reward) => accumulated + web3.utils.toBigInt(reward[1]), bigZero);
    const recentAvgTip = web3.utils.toBigInt(midTipSum / web3.utils.toBigInt(feeHistory.reward.length));

    let tip = recentAvgTip * bigTwo;

    if (tip < threeGwei) {
        tip = threeGwei;
    }
    if (tip > eightGwei) {
        context.log(`Skipping trait because it is too expensive right now. Tip was at: ${tip}`);
        return false;
    }

    const curNonce = await web3.eth.getTransactionCount(process.env['CONTRACT_OWNER_WALLET_ADDRESS']);
    const curNoncepending = await web3.eth.getTransactionCount(process.env['CONTRACT_OWNER_WALLET_ADDRESS'], 'pending');
    if (curNonce != curNoncepending) {
        context.log(`Can't be certain current nonce is correct. Transactions pending. Gonna wait to add traits. (nonces: ${curNonce}, ${curNoncepending})`);
        return false;
    }

    const maxFee = tip + latestblock.baseFeePerGas;
    const txOptions = {
        type: '0x2',
        maxPriorityFeePerGas: tip,
        from: process.env['CONTRACT_OWNER_WALLET_ADDRESS'],
        maxFeePerGas: maxFee,
    };
    const methodDef = contract.methods[methodName](...methodArgs);
    const estimatedGas = await methodDef.estimateGas();
    txOptions["gas"] = estimatedGas + (estimatedGas / bigTen);

    context.log(`${methodName} ${methodArgs}, tip: ${tip}, maxfee: ${maxFee}, gas limit: ${txOptions["gas"]}`);
    return await methodDef.send(txOptions);
};

module.exports = { web3, getContract, usingTestnet, sendContractTx };