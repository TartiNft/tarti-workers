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
    const bigTwo = web3.utils.toBigInt(2);
    const bigten = web3.utils.toBigInt(10);
    const latestGasLimit = latestblock.gasLimit;
    const feeHistory = await web3.eth.getFeeHistory(1, "latest", [25, 50, 75, 95]);
    const recentHighTip = web3.utils.toBigInt(feeHistory.reward[0][3]);
    let tip = recentHighTip * bigTwo;
    let baseFee = latestblock.baseFeePerGas + bigten;

    if (tip < threeGwei) {
        tip = threeGwei;
    }
    if (baseFee < tip) {
        baseFee = tip;
    }

    const maxFee = tip + baseFee;
    const curNonce = await web3.eth.getTransactionCount(process.env['CONTRACT_OWNER_WALLET_ADDRESS']);
    const curNoncepending = await web3.eth.getTransactionCount(process.env['CONTRACT_OWNER_WALLET_ADDRESS'], 'pending');

    context.log(`${methodName} ${methodArgs}, gas limit: ${latestGasLimit}`);

    if (curNonce != curNoncepending) {
        context.log(`Can't be certain current nonce is correct. Transactions pending. Gonna wait to add traits. (nonces: ${curNonce}, ${curNoncepending})`);
        return false;
    }

    const txOptions = {
        type: '0x2',
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: tip,
        gas: latestGasLimit,
        from: process.env['CONTRACT_OWNER_WALLET_ADDRESS']
    };

    return await contract.methods[methodName](...methodArgs).send(txOptions);
};

module.exports = { web3, getContract, usingTestnet, sendContractTx };