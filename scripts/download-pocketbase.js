#!/usr/bin/env node
/**
 * Downloads PocketBase binary for the current platform
 * Run automatically on npm install via postinstall
 */

import { createWriteStream, existsSync, mkdirSync, chmodSync } from 'fs'
import { pipeline } from 'stream/promises'
import { createGunzip } from 'zlib'
import { Extract } from 'unzipper'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PB_VERSION = '0.23.4'
const PB_DIR = join(__dirname, '..', 'pocketbase')
const PB_BINARY = join(PB_DIR, process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase')

function getPlatformUrl() {
	const platform = process.platform
	const arch = process.arch

	let os, architecture

	if (platform === 'darwin') {
		os = 'darwin'
		architecture = arch === 'arm64' ? 'arm64' : 'amd64'
	} else if (platform === 'linux') {
		os = 'linux'
		architecture = arch === 'arm64' ? 'arm64' : 'amd64'
	} else if (platform === 'win32') {
		os = 'windows'
		architecture = arch === 'arm64' ? 'arm64' : 'amd64'
	} else {
		throw new Error(`Unsupported platform: ${platform}`)
	}

	return `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_${os}_${architecture}.zip`
}

async function download() {
	if (existsSync(PB_BINARY)) {
		console.log('PocketBase already downloaded')
		return
	}

	const url = getPlatformUrl()
	console.log(`Downloading PocketBase ${PB_VERSION}...`)
	console.log(`URL: ${url}`)

	if (!existsSync(PB_DIR)) {
		mkdirSync(PB_DIR, { recursive: true })
	}

	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(`Failed to download: ${response.status} ${response.statusText}`)
	}

	// Extract zip
	await pipeline(
		response.body,
		Extract({ path: PB_DIR })
	)

	// Make executable on Unix
	if (process.platform !== 'win32') {
		chmodSync(PB_BINARY, 0o755)
	}

	console.log('PocketBase downloaded successfully')
}

download().catch(err => {
	console.error('Failed to download PocketBase:', err.message)
	process.exit(1)
})
