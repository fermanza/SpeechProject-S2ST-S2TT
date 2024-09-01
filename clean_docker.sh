# cleanup_docker.sh
#!/bin/sh

# down volumes and remove them
docker-compose down -v --rmi all

# Prune all unused Docker objects, including volumes
docker system prune --volumes
