#!/bin/bash
set -e

echo "Starting tinykit..."

# Ensure Pocketbase data directory exists
mkdir -p pocketbase/pb_data

# Ensure Pocketbase binary is executable
chmod +x ./pocketbase/pocketbase

# Start Pocketbase in the background
echo "Starting Pocketbase..."
./pocketbase/pocketbase serve --http=127.0.0.1:8091 &
PB_PID=$!

# Wait for Pocketbase to be ready
echo "Waiting for Pocketbase to start..."
for i in {1..30}; do
	if curl -s http://127.0.0.1:8091/api/health > /dev/null 2>&1; then
		echo "Pocketbase is ready!"
		break
	fi
	if [ $i -eq 30 ]; then
		echo "Pocketbase failed to start"
		kill $PB_PID 2>/dev/null || true
		exit 1
	fi
	sleep 1
done

# Create superuser if credentials are provided (required for fresh deploys)
if [ -n "$POCKETBASE_ADMIN_EMAIL" ] && [ -n "$POCKETBASE_ADMIN_PASSWORD" ]; then
	echo "Ensuring superuser exists..."
	./pocketbase/pocketbase superuser upsert "$POCKETBASE_ADMIN_EMAIL" "$POCKETBASE_ADMIN_PASSWORD" 2>/dev/null || true
	echo "Superuser ready!"
fi

# Note: Collections are created automatically via pb_migrations/

# Start the Node.js server
echo "Starting SvelteKit server..."
node build/index.js &
NODE_PID=$!

# Handle shutdown gracefully
trap 'echo "Shutting down..."; kill $PB_PID $NODE_PID 2>/dev/null || true; exit 0' SIGTERM SIGINT

# Wait for either process to exit
wait -n

# If one exits, kill the other
kill $PB_PID $NODE_PID 2>/dev/null || true
exit $?
