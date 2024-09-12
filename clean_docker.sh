# cleanup_docker.sh
#!/bin/sh

# Prune
docker system prune -a
# down volumes and remove them
docker-compose down -v --rmi all

# Prune all unused Docker objects, including volumes
docker system prune --volumes
