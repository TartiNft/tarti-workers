/**
 * POST something to the TRAIT AI API (via TraitHttpIO) 
 * @param {string} command 
 * @param {string[]} contextParams 
 * @param {*} body 
 * @returns An object representing the response
 */
const postTraitAi = (command, contextParams, body) => {
    const axios = require('axios');
    let contextParamsQueryString = "";

    for (const param in contextParams) {
        contextParamsQueryString = `&${param}=${contextParams[param]} ${contextParamsQueryString}`;
    }
    return axios.post(`${process.env["TRAIT_HTTP_URI"]}/${command}?${contextParamsQueryString.trim()}`, body).then(function (response) {
        const parsedResponseString = response.data.BotResponse.trim();
        try {
            const parsedResponse = JSON.parse(parsedResponseString);
            return parsedResponse;
        } catch (error) {
            throw new Error("Invalid response from Trait AI: " + parsedResponse);
        }
    });
};

/**
 * GET something from the TRAIT AI API (via TraitHttpIO) 
 * @param {string} command 
 * @param {string[]} contextParams 
 * @returns An object representing the response
 */
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

/**
 * Prompt a TRAIT AI bot (via TraitHttpIO)
 * @param {string} prompt 
 * @param {*} metaData 
 * @param {*} contextParams 
 * @returns An object representing the response
 */
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