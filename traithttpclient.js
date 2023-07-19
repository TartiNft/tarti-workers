const postTraitAi = (command, contextParams, body) => {
    const axios = require('axios');
    let contextParamsQueryString = "";

    for (const param in contextParams) {
        contextParamsQueryString = `&${param}=${contextParams[param]} ${contextParamsQueryString}`;
    }
    return axios.post(`${process.env["TRAIT_HTTP_URI"]}/${command}?${contextParamsQueryString.trim()}`, body).then(function (response) {
        let parsedResponse = response.data.BotResponse.trim();
        try {
            parsedResponse = JSON.parse(parsedResponse);
        } catch (error) {
            throw new Error("Invalid response from Trait AI: " + parsedResponse);
        }
        return parsedResponse;
    });
};

const getTraitAi = (command, contextParams) => {
    const axios = require('axios');
    let contextParamsQueryString = "";

    for (const param in contextParams) {
        contextParamsQueryString = `&${param}=${contextParams[param]} ${contextParamsQueryString}`;
    }
    return axios.get(`${process.env["TRAIT_HTTP_URI"]}/${command}?${contextParamsQueryString.trim()}`).then(function (response) {
        let parsedResponse = response.data.BotResponse.trim();
        try {
            parsedResponse = JSON.parse(parsedResponse);
        } catch (error) {
            throw new Error("Invalid response from Trait AI: " + parsedResponse);
        }
        return parsedResponse;
    });
};

const promptBot = (prompt, metaData, contextParams) => {
    if (!contextParams) {
        contextParams = {};
    }
    contextParams["prompt"] = prompt;
    return postTraitAi("prompt_bot", contextParams, {
        bot_metadata: metaData
    }).then(function (response) {
        return response;
    });
};

module.exports = { postTraitAi, getTraitAi, promptBot };