# tarti-nft-worker

Work Consumer.

- Watches for new tartis that are queued for creation on a Redis Queue and it will do the work.
- Will run once and finish. It needs to be constantly run to keep checking for newly minted tokens. Use some sort of job scheduler like cron.
- Currently we use docker-compose auto-restarts to continually spin up a fresh container and make a pass.