# tarti-nft-watcher

Work Producer.

- Watches for TARTST and TARTI tokens to be minted. When they are minted, puts a message on a Redis Queue notifying the system of the event.
- Will run once and finish. It needs to be constantly run to keep checking for newly minted tokens. Use some sort of job scheduler like cron.
- Currently we use docker-compose auto-restarts to continually spin up a fresh container and make a pass.
