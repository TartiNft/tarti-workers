module.exports = async function (context, tartiSbMsg) {
    context.log('JavaScript ServiceBus queue trigger function processed message', tartiSbMsg);
};