/**
 * Client-side Pocketbase module with auth store
 *
 * This module provides:
 * - A singleton PocketBase client that works in the browser
 * - Reactive auth state using Svelte 5 runes
 * - Login/register/logout functions
 *
 * Usage in components:
 *   import { pb, auth } from '$lib/pocketbase'
 *
 *   // Check auth state
 *   if (auth.is_authenticated) { ... }
 *
 *   // Login
 *   await auth.login(email, password)
 *
 *   // Use PB directly
 *   const projects = await pb.collection('_tk_projects').getFullList()
 */

import PocketBase from 'pocketbase'
import type { AuthModel } from 'pocketbase'

// Use the proxy URL so we stay on same origin (avoids CORS issues)
// In browser: /_pb proxies to Pocketbase
// On server: use direct URL
const PB_URL = typeof window !== 'undefined' ? '/_pb' : 'http://127.0.0.1:8091'

// Singleton PocketBase client
export const pb = new PocketBase(PB_URL)

// Disable auto cancellation for concurrent requests
pb.autoCancellation(false)

// Auth state using Svelte 5 runes
// This creates a reactive store that components can use
class AuthStore {
	user = $state<AuthModel | null>(null)
	is_loading = $state(true)
	error = $state<string | null>(null)

	constructor() {
		// Initialize from existing auth store (persisted in localStorage)
		if (typeof window !== 'undefined') {
			this.user = pb.authStore.model

			// Listen for auth changes (login, logout, token refresh)
			pb.authStore.onChange((token, model) => {
				this.user = model
			})

			// Validate existing token on load
			if (pb.authStore.isValid && pb.authStore.model) {
				// Try to refresh the token to verify it's still valid
				pb.collection('users').authRefresh()
					.then((auth_data) => {
						this.user = auth_data.record
						this.is_loading = false
					})
					.catch(() => {
						// Token is invalid, clear it
						console.warn('[Auth] Token invalid, clearing auth')
						pb.authStore.clear()
						this.user = null
						this.is_loading = false
					})
			} else {
				this.is_loading = false
			}
		} else {
			this.is_loading = false
		}
	}

	get is_authenticated(): boolean {
		return pb.authStore.isValid && !!this.user
	}

	get token(): string | null {
		return pb.authStore.token
	}

	async login(email: string, password: string): Promise<AuthModel> {
		this.error = null
		this.is_loading = true

		try {
			const auth_data = await pb.collection('users').authWithPassword(email, password)
			this.user = auth_data.record
			return auth_data.record
		} catch (err: any) {
			this.error = err.message || 'Login failed'
			throw err
		} finally {
			this.is_loading = false
		}
	}

	async register(email: string, password: string, name?: string): Promise<AuthModel> {
		this.error = null
		this.is_loading = true

		try {
			// Create the user
			await pb.collection('users').create({
				email,
				password,
				passwordConfirm: password,
				name: name || email.split('@')[0]
			})

			// Auto-login after registration
			return await this.login(email, password)
		} catch (err: any) {
			this.error = err.message || 'Registration failed'
			throw err
		} finally {
			this.is_loading = false
		}
	}

	logout(): void {
		pb.authStore.clear()
		this.user = null
		this.error = null
	}

	// Refresh auth token if needed
	async refresh(): Promise<void> {
		if (!pb.authStore.isValid) return

		try {
			const auth_data = await pb.collection('users').authRefresh()
			this.user = auth_data.record
		} catch {
			// Token expired or invalid, clear auth
			this.logout()
		}
	}
}

// Export singleton auth store
export const auth = new AuthStore()

// Types for the users collection
export interface User {
	id: string
	email: string
	name: string
	avatar?: string
	created: string
	updated: string
}

// Re-export Project type for convenience
export type { Project, ProjectSettings } from '../routes/tinykit/types'
