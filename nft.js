let web3;
const { Web3 } = require('web3');
const ethClientUri = process.env["ETH_CLIENT_URL"];
web3 = new Web3(Web3.HTTPProvider(ethClientUri));
web3.eth.accounts.wallet.add(process.env['CONTRACT_OWNER_WALLET_PK']);

const getContract = async (contractJsonFile) => {
    const fs = require('fs');
    const contractJson = JSON.parse(fs.readFileSync(contractJsonFile));
    const netId = await web3.eth.net.getId();
    const deployedNetwork = contractJson.networks[netId];
    return new web3.eth.Contract(
        contractJson.abi,
        deployedNetwork && deployedNetwork.address
    );
};

const usingTestnet = async () => {
    return (await web3.eth.net.getId()) !== 1;
};

module.exports = { web3, getContract, usingTestnet };