.PHONY: build up down logs restart shell test lint typecheck

# Build and start the app
up:
	docker compose up --build -d

# Stop the app
down:
	docker compose down

# Build images
build:
	docker compose build

# View logs
logs:
	docker compose logs -f

# Restart
restart:
	docker compose down && docker compose up --build -d

# Open shell in container
shell:
	docker compose exec app sh

# Run tests in container
test:
	docker compose exec app npm run test

# Lint
lint:
	docker compose exec app npm run lint

# Typecheck
typecheck:
	docker compose exec app npm run typecheck

# Stop and remove volumes
clean:
	docker compose down -v
