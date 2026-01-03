import { json } from "@sveltejs/kit"
import type { RequestHandler } from "./$types"
import PocketBase from "pocketbase"
import { env } from "$env/dynamic/private"
import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)
const PB_URL = env.POCKETBASE_URL || "http://127.0.0.1:8091"

// GET: Check if setup is needed
export const GET: RequestHandler = async () => {
	try {
		// Check if the setup marker file exists
		// This file is created after successful setup
		const fs = await import("fs/promises")
		const marker_path = "./pocketbase/pb_data/.setup_complete"

		try {
			await fs.access(marker_path)
			return json({ needs_setup: false })
		} catch {
			// File doesn't exist, setup is needed
			return json({ needs_setup: true })
		}
	} catch (err: any) {
		return json({
			needs_setup: true,
			error: err.message
		})
	}
}

// POST: Complete setup - create superuser and first user account
export const POST: RequestHandler = async ({ request }) => {
	try {
		// Check if setup already completed using marker file
		const fs = await import("fs/promises")
		const marker_path = "./pocketbase/pb_data/.setup_complete"
		try {
			await fs.access(marker_path)
			return json({ error: "Setup already completed" }, { status: 400 })
		} catch {
			// Marker doesn't exist, continue with setup
		}

		const { email, password, llm } = await request.json()

		if (!email || !password) {
			return json({ error: "Email and password are required" }, { status: 400 })
		}

		if (password.length < 8) {
			return json({ error: "Password must be at least 8 characters" }, { status: 400 })
		}

		const pb = new PocketBase(PB_URL)

		// 1. Create PocketBase superuser using CLI
		// This requires the pocketbase binary to be available
		// Using execFile with array args to prevent command injection
		try {
			const pb_path = "./pocketbase/pocketbase"
			console.log("[Setup] Creating superuser for:", email)
			const { stdout, stderr } = await execFileAsync(pb_path, ["superuser", "upsert", email, password])
			console.log("[Setup] Superuser stdout:", stdout)
			if (stderr) console.log("[Setup] Superuser stderr:", stderr)
		} catch (err: any) {
			console.error("[Setup] Failed to create superuser:", err.message)
			return json({ error: "Failed to create superuser" }, { status: 500 })
		}

		// 2. Authenticate as the new superuser
		console.log("[Setup] Authenticating as superuser...")
		try {
			await pb.collection("_superusers").authWithPassword(email, password)
			console.log("[Setup] Authenticated as superuser")
		} catch (err: any) {
			console.error("[Setup] Failed to authenticate as superuser:", err.message)
			return json({ error: "Superuser created but authentication failed: " + err.message }, { status: 500 })
		}

		// 3. Ensure users collection exists and is properly configured
		console.log("[Setup] Checking users collection...")
		try {
			const usersCollection = await pb.collections.getOne("users")
			console.log("[Setup] Users collection exists:", usersCollection.name)
		} catch (err: any) {
			console.log("[Setup] Users collection not found, creating it...")
			try {
				await pb.collections.create({
					name: "users",
					type: "auth",
					schema: [
						{ name: "name", type: "text", required: false }
					],
					createRule: "", // empty = anyone can create (for initial setup)
					listRule: "@request.auth.id != ''",
					viewRule: "@request.auth.id != ''",
					updateRule: "@request.auth.id = id",
					deleteRule: null
				})
				console.log("[Setup] Users collection created")
			} catch (createErr: any) {
				console.error("[Setup] Failed to create users collection:", createErr)
				return json({ error: "Failed to create users collection: " + (createErr.message || JSON.stringify(createErr)) }, { status: 500 })
			}
		}

		// 4. Create the first user account with same credentials
		console.log("[Setup] Creating user account...")
		try {
			await pb.collection("users").create({
				email,
				password,
				passwordConfirm: password,
				name: "Admin"
			})
			console.log("[Setup] User account created")
		} catch (err: any) {
			console.error("[Setup] Failed to create user account:", err)
			const errorDetail = err.response?.data || err.data || err.message || "Unknown error"
			return json({ error: "Superuser created but user account creation failed: " + JSON.stringify(errorDetail) }, { status: 500 })
		}

		// 5. Update users collection to disallow public registration (after user is created)
		console.log("[Setup] Updating users collection rules...")
		try {
			const usersCollection = await pb.collections.getOne("users")
			await pb.collections.update(usersCollection.id, {
				createRule: null // null = no one can create (disabled)
			})
			console.log("[Setup] Users collection updated")
		} catch (err: any) {
			console.error("[Setup] Failed to update users collection rules:", err.message)
			// Non-fatal, continue
		}

		// 6. Save LLM settings if provided
		// Note: _tk_settings and _tk_projects collections are created by PocketBase migrations
		if (llm && llm.api_key) {
			console.log("[Setup] Saving LLM settings...")
			try {
				await pb.collection("_tk_settings").create({
					id: "llm",
					value: {
						provider: llm.provider,
						api_key: llm.api_key,
						model: llm.model
					}
				})
				console.log("[Setup] LLM settings saved")
			} catch (err: any) {
				console.error("[Setup] Failed to save LLM settings:", err.message)
				// Non-fatal, user can configure later
			}
		}

		// 7. Save auth token for server-side operations
		// We save the token (not password) - it can be refreshed by the server
		try {
			const fs = await import("fs/promises")
			const setup_data = JSON.stringify({
				timestamp: new Date().toISOString(),
				admin_email: email,
				auth_token: pb.authStore.token
			})
			await fs.writeFile("./pocketbase/pb_data/.setup_complete", setup_data, { mode: 0o600 })
			console.log("[Setup] Auth token saved")
		} catch (err: any) {
			console.error("[Setup] Failed to save auth token:", err.message)
			// Non-fatal
		}

		return json({ success: true })
	} catch (err: any) {
		console.error("Setup error:", err)
		return json({ error: err.message || "Setup failed" }, { status: 500 })
	}
}
