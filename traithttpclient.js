const postTraitAi = (command, contextParams, body) => {
    const axios = require('axios');
    let contextParamsQueryString = "";

    for (const param in contextParams) {
        contextParamsQueryString = `&${param}=${contextParams[param]} ${contextParamsQueryString}`;
    }
    return axios.post(`${process.env["TRAIT_HTTP_URI"]}/${command}?${contextParamsQueryString.trim()}`, body).then(function (response) {
        return JSON.parse(response.data.BotResponse.trim());
    });
};

const getTraitAi = (command, contextParams) => {
    const axios = require('axios');
    let contextParamsQueryString = "";

    for (const param in contextParams) {
        contextParamsQueryString = `&${param}=${contextParams[param]} ${contextParamsQueryString}`;
    }
    return axios.get(`${process.env["TRAIT_HTTP_URI"]}/${command}?${contextParamsQueryString.trim()}`).then(function (response) {
        return JSON.parse(response.data.BotResponse.trim());
    });
};
module.exports = { postTraitAi, getTraitAi };