add-traits-to-tartist

utility function.

- Reads traits from TraitAI and writes them to the Tartist contract on the blockchain
- Needs to be run anytime traits are added to TraitAI
- Will run once and finish. It needs to be constantly run to keep checking for newly minted tokens. Use some sort of job scheduler like cron.
- Currently we use docker-compose auto-restarts to continually spin up a fresh container and make a pass.
