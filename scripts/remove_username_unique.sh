#!/bin/bash

# Remove username unique constraint from users table
# This script removes the unique constraint so users can have duplicate usernames

# Database connection variables (adjust as needed)
DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-mindcoach}"
DB_PASSWORD="${DB_PASSWORD:-}"

echo "Removing username unique constraint from users table..."

if [ -z "$DB_PASSWORD" ]; then
    mysql -h "$DB_HOST" -u "$DB_USER" "$DB_NAME" < database/migrations/002_remove_username_unique_constraint.sql
else
    mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < database/migrations/002_remove_username_unique_constraint.sql
fi

if [ $? -eq 0 ]; then
    echo "✅ Username unique constraint removed successfully!"
else
    echo "❌ Error removing username unique constraint"
    exit 1
fi

