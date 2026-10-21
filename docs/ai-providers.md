# AI providers

You can use Tinykit's templates, editor, database, and published apps without paying for model calls. AI-assisted editing is optional.

## Settings

1. Open `/tinykit/settings`.
2. Choose a provider and enter the exact model ID from that provider.
3. Enter the API key, if required. For **Custom / local (OpenAI-compatible)**, enter the server's API base URL too.
4. Select **Test** to check the connection, then **Save Settings**.

The connection test requests `/models` for OpenAI-compatible servers. A successful test confirms that this endpoint is reachable; it does not guarantee that a particular model supports generation, streaming, or tool calling. Tinykit's builder needs all three. Some servers do not expose `/models`; you can still save the settings and try the builder.

Changing provider or URL does not carry over the previous server's saved key. For a server without authentication, leave the key empty. To remove a key already saved for the same custom server, select **Remove saved API key**.

### DeepSeek

Choose **DeepSeek**, enter your DeepSeek key and a model ID from [DeepSeek's documentation](https://api-docs.deepseek.com/). The default API base URL is `https://api.deepseek.com`; an example model ID is `deepseek-flash`. Tinykit sends Chat Completions requests and keeps history summaries on the same provider and model.

### LM Studio and other local servers

Start your server and load a model with tool support. For [LM Studio](https://lmstudio.ai/docs/developer/openai-compat), the usual API base URL is `http://localhost:1234/v1`. Use the exact model identifier shown by your server.

The same option can connect to other servers exposing OpenAI-compatible Chat Completions. Include any required path prefix such as `/v1`, but do not append `/chat/completions`. Compatibility depends on the server and model; these integrations are not all individually certified.

### Networking from Docker

The URL is resolved by the Tinykit server, not your browser. Inside Docker, `localhost` refers to the Tinykit container. To reach a model server on the Docker host, use `http://host.docker.internal:1234/v1`. The supplied Compose file includes the host gateway mapping for Linux. The model server must listen on an interface reachable by Docker; a loopback-only server may need its listening settings changed.

For a remote Tinykit instance, use a model endpoint reachable from that server. Keep private model endpoints on your trusted network or protect them with authentication.

## Environment configuration

Nonempty `LLM_API_KEY` or `LLM_BASE_URL` selects environment configuration ahead of saved settings. These variables form one configuration; they are not merged with saved credentials. To use Settings instead, leave both unset.

```env
# Keyless local server, when Tinykit runs directly on the same machine
LLM_PROVIDER=openai-compatible
LLM_MODEL=your-loaded-model-id
LLM_BASE_URL=http://localhost:1234/v1
LLM_API_KEY=
```

```env
LLM_PROVIDER=deepseek
LLM_MODEL=deepseek-flash
LLM_API_KEY=your-deepseek-key
```

The supplied Docker Compose file forwards all four variables. When loading the repository-root `.env` file, run from the repository root:

```bash
docker compose --env-file .env -f deploy/docker/docker-compose.yml up -d --build
```

OpenAI without a custom URL retains its existing Responses API behavior. OpenAI with a custom URL, DeepSeek, and Custom / local use Chat Completions. Anthropic and Gemini use their native APIs.

## Data and future integrations

Self-hosting keeps Tinykit's database and files on your server. Using a hosted model still sends prompts and relevant app context to that provider. Local models avoid that particular hosted-model dependency, but backups, access controls, and any third-party services used by an app remain your responsibility.

A local model server is different from a local coding agent. This release does not connect to coding-agent subscriptions or their usage allowances. A future agent workflow could build apps while Tinykit provides storage, editing, and hosting.
