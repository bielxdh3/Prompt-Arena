use std::{
    collections::{BTreeMap, BTreeSet},
    io::{self, BufReader, Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    str::FromStr,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::runtime::{
    CancellationToken, Capability, ChatMessage, GenerationChunk, GenerationParameter,
    GenerationRequest, GenerationResponse, MessageRole, ModelInfo, ResponseFormat,
    RuntimeCapabilities, RuntimeError, RuntimeHealth, RuntimeProvider, TimingMetrics, ToolCall,
    ToolPolicy, UsageMetrics,
};

pub const DEFAULT_OLLAMA_ENDPOINT: &str = "http://127.0.0.1:11434";
pub const MAX_LOCAL_MODEL_COUNT: usize = 512;
pub const MAX_LOCAL_MODEL_METADATA_BYTES: usize = 256 * 1024;
pub const MAX_LOCAL_MODEL_NAME_BYTES: usize = 256;
const DEFAULT_CONNECT_TIMEOUT_MS: u64 = 1_500;
const DEFAULT_READ_TIMEOUT_MS: u64 = 500;
const DEFAULT_READ_DEADLINE_MS: u64 = 10 * 60 * 1000;
const MAX_READ_DEADLINE_MS: u64 = 60 * 60 * 1000;
const MAX_HTTP_LINE_BYTES: usize = 64 * 1024;
const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
/// Maximum total NDJSON payload bytes consumed and accumulated for one stream.
const MAX_STREAMED_RESPONSE_BYTES: usize = MAX_RESPONSE_BYTES;

fn default_read_deadline_ms() -> u64 {
    DEFAULT_READ_DEADLINE_MS
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OllamaConfig {
    pub endpoint: String,
    pub connect_timeout_ms: u64,
    pub read_timeout_ms: u64,
    #[serde(default = "default_read_deadline_ms")]
    pub read_deadline_ms: u64,
}

impl Default for OllamaConfig {
    fn default() -> Self {
        Self {
            endpoint: DEFAULT_OLLAMA_ENDPOINT.to_owned(),
            connect_timeout_ms: DEFAULT_CONNECT_TIMEOUT_MS,
            read_timeout_ms: DEFAULT_READ_TIMEOUT_MS,
            read_deadline_ms: DEFAULT_READ_DEADLINE_MS,
        }
    }
}

#[derive(Debug, Clone)]
pub struct OllamaEndpoint {
    host: String,
    base_path: String,
    display: String,
    connect_address: SocketAddr,
}

impl OllamaEndpoint {
    pub fn parse(input: &str) -> Result<Self, RuntimeError> {
        let endpoint = input.trim();
        let (scheme, authority_and_path) = endpoint.split_once("://").ok_or_else(|| {
            invalid_endpoint("endpoint must use an explicit http:// loopback URL")
        })?;
        if !scheme.eq_ignore_ascii_case("http") {
            return Err(invalid_endpoint(
                "only plain HTTP loopback endpoints are supported",
            ));
        }
        if authority_and_path.is_empty()
            || authority_and_path.contains('@')
            || authority_and_path.contains('?')
            || authority_and_path.contains('#')
            || endpoint.chars().any(|character| character.is_control())
        {
            return Err(invalid_endpoint(
                "endpoint credentials, query strings, fragments, and control characters are not allowed",
            ));
        }

        let (authority, raw_path) =
            if let Some((authority, path)) = authority_and_path.split_once('/') {
                (authority, format!("/{path}"))
            } else {
                (authority_and_path, "/".to_owned())
            };
        if authority.is_empty() || authority.contains('\\') {
            return Err(invalid_endpoint("endpoint authority is invalid"));
        }

        let (host, port) = parse_authority(authority)?;
        let normalized_host = host.to_ascii_lowercase();
        let ip = if normalized_host == "localhost" {
            IpAddr::V4(Ipv4Addr::LOCALHOST)
        } else if let Ok(ip) = IpAddr::from_str(&normalized_host) {
            if !ip.is_loopback() {
                return Err(invalid_endpoint("endpoint host must be loopback-only"));
            }
            ip
        } else {
            return Err(invalid_endpoint(
                "endpoint host must be localhost or a loopback IP literal",
            ));
        };

        if port == 0 {
            return Err(invalid_endpoint("endpoint port must be greater than zero"));
        }

        let base_path = normalize_base_path(&raw_path)?;
        let display_host = match ip {
            IpAddr::V6(_) => format!("[{normalized_host}]"),
            IpAddr::V4(_) => normalized_host,
        };
        let display = format!(
            "http://{display_host}:{port}{}",
            if base_path.is_empty() { "" } else { &base_path }
        );

        Ok(Self {
            host: display_host,
            base_path,
            display,
            connect_address: SocketAddr::new(ip, port),
        })
    }

    pub fn as_str(&self) -> &str {
        &self.display
    }

    fn request_path(&self, suffix: &str) -> String {
        format!("{}{}", self.base_path, suffix)
    }
}

#[derive(Debug, Clone)]
pub struct OllamaProvider {
    config: OllamaConfig,
    endpoint: OllamaEndpoint,
}

impl OllamaProvider {
    pub fn new(config: OllamaConfig) -> Result<Self, RuntimeError> {
        if !(1..=120_000).contains(&config.connect_timeout_ms)
            || !(1..=120_000).contains(&config.read_timeout_ms)
        {
            return Err(RuntimeError::InvalidConfiguration {
                message: "runtime timeouts must be between 1ms and 120s".to_owned(),
            });
        }
        if !(1..=MAX_READ_DEADLINE_MS).contains(&config.read_deadline_ms) {
            return Err(RuntimeError::InvalidConfiguration {
                message: "runtime read deadline must be between 1ms and 60 minutes".to_owned(),
            });
        }
        let endpoint = OllamaEndpoint::parse(&config.endpoint)?;
        Ok(Self { config, endpoint })
    }

    pub fn default_local() -> Result<Self, RuntimeError> {
        Self::new(OllamaConfig::default())
    }

    pub fn config(&self) -> &OllamaConfig {
        &self.config
    }

    fn request(
        &self,
        method: &str,
        suffix: &str,
        payload: Option<&Value>,
        cancellation: &CancellationToken,
    ) -> Result<HttpResponse, RuntimeError> {
        if cancellation.is_cancelled() {
            return Err(RuntimeError::Cancelled);
        }

        let body = payload
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|_| RuntimeError::Protocol {
                message: "request could not be encoded".to_owned(),
            })?
            .unwrap_or_default();
        let address = self.endpoint.connect_address;
        let mut stream = TcpStream::connect_timeout(
            &address,
            Duration::from_millis(self.config.connect_timeout_ms),
        )
        .map_err(|error| RuntimeError::Unavailable {
            message: format!("could not connect to local runtime: {error}"),
        })?;
        let read_timeout = Some(Duration::from_millis(
            self.config
                .read_timeout_ms
                .min(self.config.read_deadline_ms),
        ));
        let write_timeout = Some(Duration::from_millis(self.config.read_timeout_ms));
        stream
            .set_read_timeout(read_timeout)
            .and_then(|_| stream.set_write_timeout(write_timeout))
            .map_err(|error| RuntimeError::Transport {
                message: format!("could not configure local runtime socket: {error}"),
            })?;

        let path = self.endpoint.request_path(suffix);
        let content_type = if payload.is_some() {
            "Content-Type: application/json\r\n"
        } else {
            ""
        };
        let request = format!(
            "{method} {path} HTTP/1.1\r\nHost: {}\r\nAccept: application/json\r\n{content_type}Connection: close\r\nContent-Length: {}\r\n\r\n",
            self.endpoint.host,
            body.len()
        );
        stream
            .write_all(request.as_bytes())
            .and_then(|_| stream.write_all(&body))
            .map_err(|error| RuntimeError::Transport {
                message: format!("could not send local runtime request: {error}"),
            })?;
        let read_deadline = Instant::now() + Duration::from_millis(self.config.read_deadline_ms);
        read_http_response(stream, cancellation, read_deadline)
    }

    fn json_request(
        &self,
        method: &str,
        suffix: &str,
        payload: Option<&Value>,
        cancellation: &CancellationToken,
    ) -> Result<Value, RuntimeError> {
        let response = self.request(method, suffix, payload, cancellation)?;
        let status = response.status;
        let read_deadline = response.read_deadline;
        let body = read_body_string(response.body, cancellation, read_deadline)?;
        if !(200..300).contains(&status) {
            return Err(normalize_remote_error(status, &body, None));
        }
        serde_json::from_str(&body).map_err(|error| RuntimeError::Protocol {
            message: format!("runtime returned malformed JSON: {error}"),
        })
    }

    fn generation_payload(
        &self,
        request: &GenerationRequest,
        stream: bool,
    ) -> Result<(&'static str, Value), RuntimeError> {
        self.negotiate(request)?;
        if !matches!(request.tool_policy, ToolPolicy::None | ToolPolicy::Auto) {
            return Err(RuntimeError::UnsupportedParameter {
                parameter: GenerationParameter::ToolPolicy,
            });
        }

        let mut payload = Map::new();
        payload.insert("model".to_owned(), Value::String(request.model.clone()));
        payload.insert("stream".to_owned(), Value::Bool(stream));
        if let Some(format) = response_format_value(&request.response_format) {
            payload.insert("format".to_owned(), format);
        }
        if !request.tools.is_empty() {
            payload.insert(
                "tools".to_owned(),
                Value::Array(request.tools.iter().map(ollama_tool).collect()),
            );
        }
        let options = ollama_options(request)?;
        if !options.is_empty() {
            payload.insert("options".to_owned(), Value::Object(options));
        }

        if let Some(prompt) = &request.prompt {
            payload.insert("prompt".to_owned(), Value::String(prompt.clone()));
            if let Some(system_prompt) = &request.system_prompt {
                payload.insert("system".to_owned(), Value::String(system_prompt.clone()));
            }
            Ok(("/api/generate", Value::Object(payload)))
        } else {
            let mut messages = Vec::with_capacity(request.messages.len() + 1);
            if let Some(system_prompt) = &request.system_prompt {
                messages.push(ollama_message(&ChatMessage {
                    role: MessageRole::System,
                    content: system_prompt.clone(),
                    name: None,
                    tool_call_id: None,
                }));
            }
            messages.extend(request.messages.iter().map(ollama_message));
            payload.insert("messages".to_owned(), Value::Array(messages));
            Ok(("/api/chat", Value::Object(payload)))
        }
    }
}

impl RuntimeProvider for OllamaProvider {
    fn provider_id(&self) -> &'static str {
        "ollama"
    }

    fn endpoint(&self) -> &str {
        self.endpoint.as_str()
    }

    fn capabilities(&self) -> RuntimeCapabilities {
        RuntimeCapabilities {
            capabilities: BTreeSet::from([
                Capability::Chat,
                Capability::TextGeneration,
                Capability::Streaming,
                Capability::ModelListing,
                Capability::ModelMetadata,
                Capability::ToolCalling,
                Capability::JsonResponseFormat,
                Capability::JsonSchemaResponseFormat,
                Capability::Cancellation,
                Capability::UsageMetrics,
                Capability::TimingMetrics,
            ]),
            parameters: BTreeSet::from([
                GenerationParameter::Temperature,
                GenerationParameter::TopP,
                GenerationParameter::TopK,
                GenerationParameter::MaxTokens,
                GenerationParameter::RepeatPenalty,
                GenerationParameter::StopSequences,
                GenerationParameter::Seed,
                GenerationParameter::Tools,
                GenerationParameter::ToolPolicy,
                GenerationParameter::ResponseFormat,
            ]),
        }
    }

    fn negotiate(&self, request: &GenerationRequest) -> Result<(), RuntimeError> {
        self.capabilities().validate_request(request)
    }

    fn health(&self) -> Result<RuntimeHealth, RuntimeError> {
        let cancellation = CancellationToken::new();
        let value = self.json_request("GET", "/api/version", None, &cancellation)?;
        let version = value
            .get("version")
            .and_then(Value::as_str)
            .map(str::to_owned);
        Ok(RuntimeHealth {
            provider: self.provider_id().to_owned(),
            endpoint: self.endpoint().to_owned(),
            available: true,
            version,
        })
    }

    fn list_models(&self) -> Result<Vec<ModelInfo>, RuntimeError> {
        let cancellation = CancellationToken::new();
        let value = self.json_request("GET", "/api/tags", None, &cancellation)?;
        let models = value
            .get("models")
            .and_then(Value::as_array)
            .ok_or_else(|| RuntimeError::Protocol {
                message: "runtime model list did not contain a models array".to_owned(),
            })?;
        if models.len() > MAX_LOCAL_MODEL_COUNT {
            return Err(RuntimeError::Protocol {
                message: "runtime model list exceeded the local item limit".to_owned(),
            });
        }
        let mut models = models
            .iter()
            .map(parse_model_info)
            .collect::<Result<Vec<_>, _>>()?;
        models.sort_by(|left, right| {
            left.name
                .cmp(&right.name)
                .then(left.digest.cmp(&right.digest))
        });
        Ok(models)
    }

    fn model_info(&self, model: &str) -> Result<ModelInfo, RuntimeError> {
        if model.trim().is_empty()
            || model.len() > MAX_LOCAL_MODEL_NAME_BYTES
            || model.chars().any(char::is_control)
        {
            return Err(RuntimeError::InvalidConfiguration {
                message: "model name must be non-empty and within local bounds".to_owned(),
            });
        }
        let cancellation = CancellationToken::new();
        let payload = json!({"name": model});
        let value = self.json_request("POST", "/api/show", Some(&payload), &cancellation);
        match value {
            Ok(value) => Ok(parse_model_info_with_fallback(&value, model)?),
            Err(RuntimeError::Remote {
                status: 404,
                message,
            }) if message.to_ascii_lowercase().contains("model") => {
                Err(RuntimeError::ModelNotFound {
                    model: model.to_owned(),
                })
            }
            Err(error) => Err(error),
        }
    }

    fn generate(
        &self,
        request: &GenerationRequest,
        cancellation: &CancellationToken,
    ) -> Result<GenerationResponse, RuntimeError> {
        let (path, payload) = self.generation_payload(request, false)?;
        let response = self.request("POST", path, Some(&payload), cancellation)?;
        let status = response.status;
        let read_deadline = response.read_deadline;
        let body = read_body_string(response.body, cancellation, read_deadline)?;
        if !(200..300).contains(&status) {
            return Err(normalize_remote_error(status, &body, Some(&request.model)));
        }
        let value: Value = serde_json::from_str(&body).map_err(|error| RuntimeError::Protocol {
            message: format!("runtime returned malformed generation JSON: {error}"),
        })?;
        let parsed = parse_generation(&value, &request.model)?;
        if !parsed.done {
            return Err(RuntimeError::Protocol {
                message: "non-stream generation response was not marked done".to_owned(),
            });
        }
        Ok(parsed.into_response())
    }

    fn stream(
        &self,
        request: &GenerationRequest,
        cancellation: &CancellationToken,
        on_chunk: &mut dyn FnMut(GenerationChunk) -> Result<(), RuntimeError>,
    ) -> Result<GenerationResponse, RuntimeError> {
        if !self.capabilities().supports(Capability::Streaming) {
            return Err(RuntimeError::UnsupportedCapability {
                capability: Capability::Streaming,
            });
        }
        let (path, payload) = self.generation_payload(request, true)?;
        let response = self.request("POST", path, Some(&payload), cancellation)?;
        let status = response.status;
        if !(200..300).contains(&status) {
            let read_deadline = response.read_deadline;
            let body = read_body_string(response.body, cancellation, read_deadline)?;
            return Err(normalize_remote_error(status, &body, Some(&request.model)));
        }

        let mut body = response.body;
        let read_deadline = response.read_deadline;
        let mut accumulated_streamed_bytes = 0_usize;
        let mut accumulated_text = String::new();
        let mut accumulated_tools = Vec::new();
        let mut final_response = None;
        loop {
            if cancellation.is_cancelled() {
                return Err(RuntimeError::Cancelled);
            }
            let line = match read_line_with_cancel(&mut body, cancellation, read_deadline)? {
                Some(line) => line,
                None => break,
            };
            if accumulated_streamed_bytes.saturating_add(line.len()) > MAX_STREAMED_RESPONSE_BYTES {
                return Err(RuntimeError::Protocol {
                    message: "runtime streamed response exceeded the local size limit".to_owned(),
                });
            }
            accumulated_streamed_bytes += line.len();
            if line.trim().is_empty() {
                continue;
            }
            let value: Value =
                serde_json::from_str(&line).map_err(|error| RuntimeError::Protocol {
                    message: format!("runtime returned malformed NDJSON: {error}"),
                })?;
            let parsed = parse_generation(&value, &request.model)?;
            accumulated_text.push_str(&parsed.text);
            accumulated_tools.extend(parsed.tool_calls.clone());
            on_chunk(GenerationChunk {
                text: parsed.text.clone(),
                done: parsed.done,
                tool_calls: parsed.tool_calls.clone(),
                metadata: parsed.metadata.clone(),
            })?;
            if cancellation.is_cancelled() {
                return Err(RuntimeError::Cancelled);
            }
            if parsed.done {
                final_response = Some(parsed);
                break;
            }
        }

        let mut response = final_response
            .ok_or_else(|| RuntimeError::Transport {
                message: "runtime stream disconnected before completion".to_owned(),
            })?
            .into_response();
        response.text = accumulated_text;
        response.tool_calls = accumulated_tools;
        Ok(response)
    }
}

fn invalid_endpoint(message: &str) -> RuntimeError {
    RuntimeError::InvalidConfiguration {
        message: message.to_owned(),
    }
}

fn parse_authority(authority: &str) -> Result<(String, u16), RuntimeError> {
    if authority.starts_with('[') {
        let end = authority
            .find(']')
            .ok_or_else(|| invalid_endpoint("IPv6 endpoint must close its bracket"))?;
        let host = &authority[1..end];
        let port = match authority.get(end + 1..) {
            Some("") | None => 11_434,
            Some(port) if port.starts_with(':') => port[1..]
                .parse::<u16>()
                .map_err(|_| invalid_endpoint("endpoint port is invalid"))?,
            Some(_) => return Err(invalid_endpoint("endpoint authority is invalid")),
        };
        if host.is_empty() {
            return Err(invalid_endpoint("endpoint host is empty"));
        }
        return Ok((host.to_owned(), port));
    }

    if authority.matches(':').count() > 1 {
        return Err(invalid_endpoint("IPv6 endpoints must use brackets"));
    }
    let (host, port) = if let Some((host, port)) = authority.split_once(':') {
        (
            host,
            port.parse::<u16>()
                .map_err(|_| invalid_endpoint("endpoint port is invalid"))?,
        )
    } else {
        (authority, 11_434)
    };
    if host.is_empty() {
        return Err(invalid_endpoint("endpoint host is empty"));
    }
    Ok((host.to_owned(), port))
}

fn normalize_base_path(path: &str) -> Result<String, RuntimeError> {
    if path == "/" || path.is_empty() {
        return Ok(String::new());
    }
    if !path.starts_with('/')
        || path.contains('\\')
        || path.contains('?')
        || path.contains('#')
        || path.chars().any(|character| character.is_control())
    {
        return Err(invalid_endpoint("endpoint base path is invalid"));
    }
    let segments: Vec<&str> = path.split('/').collect();
    if segments
        .iter()
        .any(|segment| segment.is_empty() || *segment == "." || *segment == "..")
    {
        return Err(invalid_endpoint(
            "endpoint base path cannot contain empty or traversal segments",
        ));
    }
    Ok(path.trim_end_matches('/').to_owned())
}

fn ollama_message(message: &ChatMessage) -> Value {
    let role = match message.role {
        MessageRole::System => "system",
        MessageRole::User => "user",
        MessageRole::Assistant => "assistant",
        MessageRole::Tool => "tool",
    };
    let mut value = Map::new();
    value.insert("role".to_owned(), Value::String(role.to_owned()));
    value.insert("content".to_owned(), Value::String(message.content.clone()));
    if let Some(name) = &message.name {
        value.insert("name".to_owned(), Value::String(name.clone()));
    }
    if let Some(tool_call_id) = &message.tool_call_id {
        value.insert(
            "tool_call_id".to_owned(),
            Value::String(tool_call_id.clone()),
        );
    }
    Value::Object(value)
}

fn ollama_tool(tool: &crate::runtime::ToolDefinition) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters,
        }
    })
}

fn response_format_value(format: &ResponseFormat) -> Option<Value> {
    match format {
        ResponseFormat::Text => None,
        ResponseFormat::JsonObject => Some(Value::String("json".to_owned())),
        ResponseFormat::JsonSchema(schema) => Some(schema.clone()),
    }
}

fn ollama_options(request: &GenerationRequest) -> Result<Map<String, Value>, RuntimeError> {
    let mut options = Map::new();
    let parameters = &request.parameters;
    if let Some(value) = parameters.temperature {
        options.insert("temperature".to_owned(), json!(value));
    }
    if let Some(value) = parameters.top_p {
        options.insert("top_p".to_owned(), json!(value));
    }
    if let Some(value) = parameters.top_k {
        options.insert("top_k".to_owned(), json!(value));
    }
    if let Some(value) = parameters.max_tokens {
        options.insert("num_predict".to_owned(), json!(value));
    }
    if let Some(value) = parameters.repeat_penalty {
        options.insert("repeat_penalty".to_owned(), json!(value));
    }
    if let Some(value) = request.seed {
        options.insert("seed".to_owned(), json!(value));
    }
    if !request.stop_sequences.is_empty() {
        options.insert("stop".to_owned(), json!(request.stop_sequences));
    }
    Ok(options)
}

#[derive(Debug)]
struct ParsedGeneration {
    model: String,
    text: String,
    tool_calls: Vec<ToolCall>,
    done: bool,
    finish_reason: Option<String>,
    usage: Option<UsageMetrics>,
    timing: Option<TimingMetrics>,
    metadata: BTreeMap<String, Value>,
}

impl ParsedGeneration {
    fn into_response(self) -> GenerationResponse {
        GenerationResponse {
            model: self.model,
            text: self.text,
            tool_calls: self.tool_calls,
            finish_reason: self.finish_reason,
            usage: self.usage,
            timing: self.timing,
            metadata: self.metadata,
        }
    }
}

fn parse_generation(
    value: &Value,
    requested_model: &str,
) -> Result<ParsedGeneration, RuntimeError> {
    let object = value.as_object().ok_or_else(|| RuntimeError::Protocol {
        message: "runtime generation item was not an object".to_owned(),
    })?;
    let message = object.get("message").and_then(Value::as_object);
    let text = message
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .or_else(|| object.get("response").and_then(Value::as_str))
        .unwrap_or_default()
        .to_owned();
    let tool_calls = message
        .and_then(|message| message.get("tool_calls"))
        .map(parse_tool_calls)
        .transpose()?
        .unwrap_or_default();
    let done = object.get("done").and_then(Value::as_bool).unwrap_or(false);
    let usage = parse_usage(object);
    let timing = parse_timing(object);
    let mut metadata = BTreeMap::new();
    if let Some(reason) = object.get("done_reason") {
        metadata.insert("doneReason".to_owned(), reason.clone());
    }

    Ok(ParsedGeneration {
        model: object
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or(requested_model)
            .to_owned(),
        text,
        tool_calls,
        done,
        finish_reason: object
            .get("done_reason")
            .and_then(Value::as_str)
            .map(str::to_owned),
        usage,
        timing,
        metadata,
    })
}

fn parse_tool_calls(value: &Value) -> Result<Vec<ToolCall>, RuntimeError> {
    let calls = value.as_array().ok_or_else(|| RuntimeError::Protocol {
        message: "runtime tool_calls was not an array".to_owned(),
    })?;
    calls
        .iter()
        .map(|call| {
            let object = call.as_object().ok_or_else(|| RuntimeError::Protocol {
                message: "runtime tool call was not an object".to_owned(),
            })?;
            let function = object
                .get("function")
                .and_then(Value::as_object)
                .ok_or_else(|| RuntimeError::Protocol {
                    message: "runtime tool call had no function object".to_owned(),
                })?;
            let name = function
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| RuntimeError::Protocol {
                    message: "runtime tool call had no function name".to_owned(),
                })?;
            let arguments = function
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| Value::Object(Map::new()));
            Ok(ToolCall {
                id: object.get("id").and_then(Value::as_str).map(str::to_owned),
                name: name.to_owned(),
                arguments,
            })
        })
        .collect()
}

fn parse_usage(object: &Map<String, Value>) -> Option<UsageMetrics> {
    let prompt_tokens = object.get("prompt_eval_count").and_then(Value::as_u64);
    let completion_tokens = object.get("eval_count").and_then(Value::as_u64);
    if prompt_tokens.is_none() && completion_tokens.is_none() {
        return None;
    }
    Some(UsageMetrics {
        prompt_tokens,
        completion_tokens,
        total_tokens: prompt_tokens
            .zip(completion_tokens)
            .map(|(prompt, completion)| prompt.saturating_add(completion)),
    })
}

fn parse_timing(object: &Map<String, Value>) -> Option<TimingMetrics> {
    let timing = TimingMetrics {
        total_duration_ns: object.get("total_duration").and_then(Value::as_u64),
        load_duration_ns: object.get("load_duration").and_then(Value::as_u64),
        prompt_eval_duration_ns: object.get("prompt_eval_duration").and_then(Value::as_u64),
        eval_duration_ns: object.get("eval_duration").and_then(Value::as_u64),
    };
    if timing.total_duration_ns.is_none()
        && timing.load_duration_ns.is_none()
        && timing.prompt_eval_duration_ns.is_none()
        && timing.eval_duration_ns.is_none()
    {
        None
    } else {
        Some(timing)
    }
}

fn parse_model_info(value: &Value) -> Result<ModelInfo, RuntimeError> {
    parse_model_info_with_fallback(value, "")
}

fn parse_model_info_with_fallback(
    value: &Value,
    fallback_name: &str,
) -> Result<ModelInfo, RuntimeError> {
    let object = value.as_object().ok_or_else(|| RuntimeError::Protocol {
        message: "runtime model record was not an object".to_owned(),
    })?;
    let details = object.get("details").and_then(Value::as_object);
    let model_info = object.get("model_info").and_then(Value::as_object);
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .or_else(|| object.get("model").and_then(Value::as_str))
        .filter(|name| !name.is_empty())
        .unwrap_or(fallback_name);
    if name.is_empty() {
        return Err(RuntimeError::Protocol {
            message: "runtime model record had no name".to_owned(),
        });
    }

    let mut metadata = BTreeMap::new();
    for (key, value) in object {
        if !matches!(
            key.as_str(),
            "name" | "model" | "digest" | "size" | "modified_at" | "details" | "model_info"
        ) {
            metadata.insert(key.clone(), value.clone());
        }
    }
    if let Some(details) = object.get("details") {
        metadata.insert("details".to_owned(), details.clone());
    }
    if let Some(model_info) = object.get("model_info") {
        metadata.insert("modelInfo".to_owned(), model_info.clone());
    }

    let model = ModelInfo {
        name: name.to_owned(),
        digest: object
            .get("digest")
            .and_then(Value::as_str)
            .map(str::to_owned),
        size_bytes: object.get("size").and_then(Value::as_u64),
        modified_at: object
            .get("modified_at")
            .and_then(Value::as_str)
            .map(str::to_owned),
        family: details
            .and_then(|details| details.get("family"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        parameter_size: details
            .and_then(|details| details.get("parameter_size"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        quantization_level: details
            .and_then(|details| details.get("quantization_level"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        context_length: model_info.and_then(context_length),
        metadata,
    };
    validate_model_info(&model)?;
    Ok(model)
}

fn validate_model_info(model: &ModelInfo) -> Result<(), RuntimeError> {
    validate_model_text(&model.name, "name", MAX_LOCAL_MODEL_NAME_BYTES)?;
    for (field, value) in [
        ("digest", model.digest.as_deref()),
        ("modified_at", model.modified_at.as_deref()),
        ("family", model.family.as_deref()),
        ("parameter_size", model.parameter_size.as_deref()),
        ("quantization_level", model.quantization_level.as_deref()),
    ] {
        if let Some(value) = value {
            validate_model_text(value, field, MAX_LOCAL_MODEL_NAME_BYTES)?;
        }
    }
    if model
        .metadata
        .keys()
        .any(|key| key.len() > MAX_LOCAL_MODEL_NAME_BYTES || key.chars().any(char::is_control))
    {
        return Err(RuntimeError::Protocol {
            message: "runtime model metadata contains an invalid key".to_owned(),
        });
    }
    let metadata_bytes =
        serde_json::to_vec(&model.metadata).map_err(|_| RuntimeError::Protocol {
            message: "runtime model metadata could not be encoded".to_owned(),
        })?;
    if metadata_bytes.len() > MAX_LOCAL_MODEL_METADATA_BYTES {
        return Err(RuntimeError::Protocol {
            message: "runtime model metadata exceeded the local size limit".to_owned(),
        });
    }
    Ok(())
}

fn validate_model_text(value: &str, field: &str, max_bytes: usize) -> Result<(), RuntimeError> {
    if value.trim().is_empty() || value.len() > max_bytes || value.chars().any(char::is_control) {
        return Err(RuntimeError::Protocol {
            message: format!("runtime model {field} is invalid or exceeds local bounds"),
        });
    }
    Ok(())
}

fn context_length(model_info: &Map<String, Value>) -> Option<u64> {
    model_info.iter().find_map(|(key, value)| {
        if key == "context_length" || key.ends_with(".context_length") {
            value.as_u64()
        } else {
            None
        }
    })
}

fn normalize_remote_error(status: u16, body: &str, model: Option<&str>) -> RuntimeError {
    let message = remote_message(body);
    if status == 404 && model.is_some() && message.to_ascii_lowercase().contains("model") {
        return RuntimeError::ModelNotFound {
            model: model.unwrap_or_default().to_owned(),
        };
    }
    RuntimeError::Remote { status, message }
}

fn remote_message(body: &str) -> String {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| body.trim().to_owned());
    if message.is_empty() {
        "remote runtime error".to_owned()
    } else {
        message.chars().take(512).collect()
    }
}

struct HttpResponse {
    status: u16,
    body: HttpBody,
    read_deadline: Instant,
}

fn read_http_response(
    stream: TcpStream,
    cancellation: &CancellationToken,
    read_deadline: Instant,
) -> Result<HttpResponse, RuntimeError> {
    let mut reader = BufReader::new(stream);
    let status_line =
        read_line_with_cancel(&mut reader, cancellation, read_deadline)?.ok_or_else(|| {
            RuntimeError::Protocol {
                message: "runtime returned no HTTP status line".to_owned(),
            }
        })?;
    let mut parts = status_line.split_whitespace();
    let version = parts.next().unwrap_or_default();
    let status = parts
        .next()
        .ok_or_else(|| RuntimeError::Protocol {
            message: "runtime returned an invalid HTTP status line".to_owned(),
        })?
        .parse::<u16>()
        .map_err(|_| RuntimeError::Protocol {
            message: "runtime returned an invalid HTTP status code".to_owned(),
        })?;
    if version != "HTTP/1.1" && version != "HTTP/1.0" {
        return Err(RuntimeError::Protocol {
            message: "runtime returned an unsupported HTTP version".to_owned(),
        });
    }

    let mut headers = BTreeMap::new();
    loop {
        let line =
            read_line_with_cancel(&mut reader, cancellation, read_deadline)?.ok_or_else(|| {
                RuntimeError::Protocol {
                    message: "runtime closed before HTTP headers were complete".to_owned(),
                }
            })?;
        if line.is_empty() {
            break;
        }
        let (name, value) = line.split_once(':').ok_or_else(|| RuntimeError::Protocol {
            message: "runtime returned a malformed HTTP header".to_owned(),
        })?;
        headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_owned());
    }

    let mode = if headers
        .get("transfer-encoding")
        .is_some_and(|value| value.to_ascii_lowercase().contains("chunked"))
    {
        BodyMode::Chunked {
            remaining: 0,
            finished: false,
        }
    } else if let Some(length) = headers.get("content-length") {
        let length = length
            .parse::<usize>()
            .map_err(|_| RuntimeError::Protocol {
                message: "runtime returned an invalid content length".to_owned(),
            })?;
        BodyMode::ContentLength(length)
    } else {
        BodyMode::UntilEof
    };

    Ok(HttpResponse {
        status,
        body: HttpBody {
            reader,
            mode,
            cancellation: cancellation.clone(),
            read_deadline,
        },
        read_deadline,
    })
}

fn read_body_string(
    body: HttpBody,
    cancellation: &CancellationToken,
    read_deadline: Instant,
) -> Result<String, RuntimeError> {
    read_body_string_with_limit(body, cancellation, read_deadline, MAX_RESPONSE_BYTES)
}

fn read_body_string_with_limit<R: Read>(
    mut body: R,
    cancellation: &CancellationToken,
    read_deadline: Instant,
    max_response_bytes: usize,
) -> Result<String, RuntimeError> {
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 8 * 1024];
    loop {
        if cancellation.is_cancelled() {
            return Err(RuntimeError::Cancelled);
        }
        check_read_deadline(read_deadline)?;
        match body.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                if bytes.len().saturating_add(read) > max_response_bytes {
                    return Err(RuntimeError::Protocol {
                        message: "runtime response exceeded the local size limit".to_owned(),
                    });
                }
                bytes.extend_from_slice(&chunk[..read]);
            }
            Err(error) if is_retryable_read(&error) => continue,
            Err(error) => {
                return Err(RuntimeError::Transport {
                    message: format!("runtime response read failed: {error}"),
                })
            }
        }
    }
    String::from_utf8(bytes).map_err(|_| RuntimeError::Protocol {
        message: "runtime response was not UTF-8".to_owned(),
    })
}

fn read_line_with_cancel<R: Read>(
    reader: &mut R,
    cancellation: &CancellationToken,
    read_deadline: Instant,
) -> Result<Option<String>, RuntimeError> {
    let mut line = Vec::new();
    let mut byte = [0_u8; 1];
    loop {
        if cancellation.is_cancelled() {
            return Err(RuntimeError::Cancelled);
        }
        check_read_deadline(read_deadline)?;
        match reader.read(&mut byte) {
            Ok(0) => {
                if line.is_empty() {
                    return Ok(None);
                }
                break;
            }
            Ok(_) => {
                line.push(byte[0]);
                if line.len() > MAX_HTTP_LINE_BYTES {
                    return Err(RuntimeError::Protocol {
                        message: "runtime returned an oversized HTTP/NDJSON line".to_owned(),
                    });
                }
                if byte[0] == b'\n' {
                    break;
                }
            }
            Err(error) if is_retryable_read(&error) => continue,
            Err(error) => {
                return Err(RuntimeError::Transport {
                    message: format!("runtime response read failed: {error}"),
                })
            }
        }
    }
    while matches!(line.last(), Some(b'\n' | b'\r')) {
        line.pop();
    }
    String::from_utf8(line)
        .map(Some)
        .map_err(|_| RuntimeError::Protocol {
            message: "runtime response line was not UTF-8".to_owned(),
        })
}

fn check_read_deadline(read_deadline: Instant) -> Result<(), RuntimeError> {
    if Instant::now() >= read_deadline {
        return Err(RuntimeError::Transport {
            message: "runtime response read deadline exceeded".to_owned(),
        });
    }
    Ok(())
}

fn is_retryable_read(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
    )
}

enum BodyMode {
    ContentLength(usize),
    Chunked { remaining: usize, finished: bool },
    UntilEof,
}

struct HttpBody {
    reader: BufReader<TcpStream>,
    mode: BodyMode,
    cancellation: CancellationToken,
    read_deadline: Instant,
}

impl Read for HttpBody {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        match &mut self.mode {
            BodyMode::ContentLength(remaining) => {
                if *remaining == 0 {
                    return Ok(0);
                }
                let limit = buffer.len().min(*remaining);
                let read = self.reader.read(&mut buffer[..limit])?;
                *remaining = remaining.saturating_sub(read);
                Ok(read)
            }
            BodyMode::UntilEof => self.reader.read(buffer),
            BodyMode::Chunked {
                remaining,
                finished,
            } => {
                if *finished {
                    return Ok(0);
                }
                if *remaining == 0 {
                    let line =
                        read_io_line(&mut self.reader, &self.cancellation, self.read_deadline)?
                            .ok_or_else(|| {
                                io::Error::new(io::ErrorKind::UnexpectedEof, "missing chunk size")
                            })?;
                    let size_text = line.split(';').next().unwrap_or_default().trim();
                    let size = usize::from_str_radix(size_text, 16).map_err(|_| {
                        io::Error::new(io::ErrorKind::InvalidData, "invalid chunk size")
                    })?;
                    if size == 0 {
                        loop {
                            if read_io_line(
                                &mut self.reader,
                                &self.cancellation,
                                self.read_deadline,
                            )?
                            .is_none_or(|line| line.is_empty())
                            {
                                break;
                            }
                        }
                        *finished = true;
                        return Ok(0);
                    }
                    *remaining = size;
                }
                let limit = buffer.len().min(*remaining);
                let read = self.reader.read(&mut buffer[..limit])?;
                *remaining = remaining.saturating_sub(read);
                if *remaining == 0 {
                    let mut terminator = [0_u8; 2];
                    self.reader.read_exact(&mut terminator)?;
                    if terminator != [b'\r', b'\n'] {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidData,
                            "invalid chunk terminator",
                        ));
                    }
                }
                Ok(read)
            }
        }
    }
}

fn read_io_line(
    reader: &mut BufReader<TcpStream>,
    cancellation: &CancellationToken,
    read_deadline: Instant,
) -> io::Result<Option<String>> {
    let mut line = Vec::new();
    let mut byte = [0_u8; 1];
    loop {
        if cancellation.is_cancelled() {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "runtime read cancelled",
            ));
        }
        if Instant::now() >= read_deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "runtime response read deadline exceeded",
            ));
        }
        let read = reader.read(&mut byte)?;
        if read == 0 {
            if line.is_empty() {
                return Ok(None);
            }
            break;
        }
        line.push(byte[0]);
        if line.len() > MAX_HTTP_LINE_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "oversized chunk line",
            ));
        }
        if byte[0] == b'\n' {
            break;
        }
    }
    while matches!(line.last(), Some(b'\n' | b'\r')) {
        line.pop();
    }
    String::from_utf8(line)
        .map(Some)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "non-UTF-8 chunk line"))
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Cursor, Read, Write},
        net::{TcpListener, TcpStream},
        sync::{Arc, Mutex},
        thread,
        time::{Duration, Instant},
    };

    use serde_json::{json, Value};

    use crate::runtime::{
        CancellationToken, ChatMessage, GenerationParameters, GenerationRequest, MessageRole,
        ResponseFormat, RuntimeError, RuntimeProvider, ToolDefinition, ToolPolicy,
    };

    use super::{
        OllamaConfig, OllamaEndpoint, OllamaProvider, DEFAULT_READ_DEADLINE_MS,
        MAX_HTTP_LINE_BYTES, MAX_LOCAL_MODEL_COUNT, MAX_LOCAL_MODEL_METADATA_BYTES,
        MAX_STREAMED_RESPONSE_BYTES,
    };

    struct MockServer {
        endpoint: String,
        requests: Arc<Mutex<Vec<String>>>,
        handle: Option<thread::JoinHandle<()>>,
    }

    enum MockReply {
        Json(u16, Value),
        Raw(u16, String),
        Chunked(u16, Vec<String>, Option<Duration>),
        Silent,
    }

    impl MockServer {
        fn start(replies: Vec<MockReply>) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let requests = Arc::new(Mutex::new(Vec::new()));
            let request_log = Arc::clone(&requests);
            let handle = thread::spawn(move || {
                for reply in replies {
                    let Ok((mut stream, _)) = listener.accept() else {
                        break;
                    };
                    stream
                        .set_read_timeout(Some(Duration::from_secs(2)))
                        .unwrap();
                    let request = read_request(&mut stream);
                    request_log.lock().unwrap().push(request);
                    write_reply(&mut stream, reply);
                }
            });
            Self {
                endpoint: format!("http://127.0.0.1:{port}"),
                requests,
                handle: Some(handle),
            }
        }

        fn provider_with_deadline(
            &self,
            read_timeout_ms: u64,
            read_deadline_ms: u64,
        ) -> OllamaProvider {
            OllamaProvider::new(OllamaConfig {
                endpoint: self.endpoint.clone(),
                connect_timeout_ms: 1_000,
                read_timeout_ms,
                read_deadline_ms,
            })
            .unwrap()
        }

        fn provider(&self) -> OllamaProvider {
            self.provider_with_deadline(50, DEFAULT_READ_DEADLINE_MS)
        }

        fn requests(&self) -> Vec<String> {
            self.requests.lock().unwrap().clone()
        }
    }

    impl Drop for MockServer {
        fn drop(&mut self) {
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
        }
    }

    fn read_request(stream: &mut TcpStream) -> String {
        let mut bytes = Vec::new();
        let mut headers_end = None;
        let mut one = [0_u8; 1];
        while headers_end.is_none() {
            if stream.read_exact(&mut one).is_err() {
                return String::from_utf8_lossy(&bytes).into_owned();
            }
            bytes.push(one[0]);
            if bytes.ends_with(b"\r\n\r\n") {
                headers_end = Some(bytes.len());
            }
        }
        let header_text = String::from_utf8_lossy(&bytes[..headers_end.unwrap()]);
        let content_length = header_text
            .lines()
            .find_map(|line| {
                line.strip_prefix("Content-Length:")?
                    .trim()
                    .parse::<usize>()
                    .ok()
            })
            .unwrap_or(0);
        let mut body = vec![0_u8; content_length];
        if stream.read_exact(&mut body).is_ok() {
            bytes.extend_from_slice(&body);
        }
        String::from_utf8_lossy(&bytes).into_owned()
    }

    fn write_reply(stream: &mut TcpStream, reply: MockReply) {
        match reply {
            MockReply::Json(status, value) => {
                let body = serde_json::to_string(&value).unwrap();
                write_fixed(stream, status, &body);
            }
            MockReply::Raw(status, body) => write_fixed(stream, status, &body),
            MockReply::Chunked(status, lines, delay) => {
                let reason = if (200..300).contains(&status) {
                    "OK"
                } else {
                    "Error"
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
                );
                for (index, line) in lines.iter().enumerate() {
                    let chunk = format!("{line}\n");
                    let _ = write!(stream, "{:X}\r\n{chunk}\r\n", chunk.len());
                    let _ = stream.flush();
                    if index == 0 {
                        if let Some(delay) = delay {
                            thread::sleep(delay);
                        }
                    }
                }
                let _ = write!(stream, "0\r\n\r\n");
                let _ = stream.flush();
            }
            MockReply::Silent => {
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
                );
                let _ = stream.flush();
                let mut byte = [0_u8; 1];
                while stream.read(&mut byte).is_ok_and(|read| read > 0) {}
            }
        }
    }

    fn write_fixed(stream: &mut TcpStream, status: u16, body: &str) {
        let reason = if (200..300).contains(&status) {
            "OK"
        } else {
            "Error"
        };
        let _ = write!(
            stream,
            "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.flush();
    }

    fn chat_request() -> GenerationRequest {
        GenerationRequest {
            model: "llama3.2:latest".to_owned(),
            messages: vec![ChatMessage {
                role: MessageRole::User,
                content: "Say hello".to_owned(),
                name: None,
                tool_call_id: None,
            }],
            ..GenerationRequest::default()
        }
    }

    #[test]
    fn endpoint_validation_is_loopback_only() {
        assert!(OllamaEndpoint::parse("http://127.0.0.1:11434").is_ok());
        assert!(OllamaEndpoint::parse("http://localhost").is_ok());
        assert!(OllamaEndpoint::parse("http://[::1]:11434").is_ok());
        for endpoint in [
            "https://127.0.0.1:11434",
            "http://8.8.8.8:11434",
            "http://0.0.0.0:11434",
            "http://user@127.0.0.1:11434",
            "http://127.0.0.1:11434?remote=true",
            "http://127.0.0.1:11434#remote",
        ] {
            assert!(matches!(
                OllamaEndpoint::parse(endpoint),
                Err(RuntimeError::InvalidConfiguration { .. })
            ));
        }
    }

    #[test]
    fn health_listing_and_metadata_are_normalized() {
        let server = MockServer::start(vec![
            MockReply::Json(200, json!({"version": "0.5.1"})),
            MockReply::Json(
                200,
                json!({"models": [{"name": "llama3.2:latest", "digest": "abc", "size": 42, "modified_at": "now", "details": {"family": "llama", "parameter_size": "3B", "quantization_level": "Q4_K_M"}}]}),
            ),
            MockReply::Json(
                200,
                json!({"details": {"family": "llama", "parameter_size": "3B"}, "model_info": {"llama.context_length": 8192}}),
            ),
        ]);
        let provider = server.provider();
        let health = provider.health().unwrap();
        assert_eq!(health.version.as_deref(), Some("0.5.1"));
        let models = provider.list_models().unwrap();
        assert_eq!(models[0].name, "llama3.2:latest");
        assert_eq!(models[0].context_length, None);
        assert_eq!(
            provider
                .model_info("llama3.2:latest")
                .unwrap()
                .context_length,
            Some(8192)
        );
        let requests = server.requests();
        assert!(requests[0].starts_with("GET /api/version HTTP/1.1"));
        assert!(requests[1].starts_with("GET /api/tags HTTP/1.1"));
        assert!(requests[2].starts_with("POST /api/show HTTP/1.1"));
    }

    #[test]
    fn model_metadata_optional_fields_and_future_fields_remain_compatible() {
        let model = super::parse_model_info(&json!({
            "model": "compat:latest",
            "size": 123,
            "details": {"family": "compat"},
            "future_metadata": {"enabled": true}
        }))
        .expect("compatible model metadata");
        assert_eq!(model.name, "compat:latest");
        assert_eq!(model.size_bytes, Some(123));
        assert_eq!(model.family.as_deref(), Some("compat"));
        assert_eq!(model.digest, None);
        assert_eq!(
            model.metadata.get("future_metadata"),
            Some(&json!({"enabled": true}))
        );
    }

    #[test]
    fn model_listing_is_sorted_and_bounded() {
        let server = MockServer::start(vec![MockReply::Json(
            200,
            json!({
                "models": [
                    {"name": "zeta:latest", "digest": "z"},
                    {"name": "alpha:latest", "digest": "a"}
                ]
            }),
        )]);
        let models = server.provider().list_models().expect("models list");
        assert_eq!(
            models
                .iter()
                .map(|model| model.name.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha:latest", "zeta:latest"]
        );

        let oversized = super::parse_model_info(&json!({
            "name": "bounded",
            "padding": "x".repeat(MAX_LOCAL_MODEL_METADATA_BYTES)
        }));
        assert!(matches!(oversized, Err(RuntimeError::Protocol { .. })));
    }

    #[test]
    fn model_listing_shape_and_count_limits_are_typed() {
        let malformed = MockServer::start(vec![MockReply::Json(200, json!({"models": {}}))]);
        assert!(matches!(
            malformed.provider().list_models(),
            Err(RuntimeError::Protocol { .. })
        ));

        let too_many = (0..=MAX_LOCAL_MODEL_COUNT)
            .map(|index| json!({"name": format!("model-{index}")}))
            .collect::<Vec<_>>();
        let server = MockServer::start(vec![MockReply::Json(200, json!({"models": too_many}))]);
        assert!(matches!(
            server.provider().list_models(),
            Err(RuntimeError::Protocol { .. })
        ));
    }

    #[test]
    fn chat_generation_maps_normalized_request_and_metrics() {
        let server = MockServer::start(vec![MockReply::Json(
            200,
            json!({
                "model": "llama3.2:latest",
                "message": {"role": "assistant", "content": "hello"},
                "done": true,
                "done_reason": "stop",
                "prompt_eval_count": 4,
                "eval_count": 2,
                "total_duration": 10,
                "load_duration": 3,
                "prompt_eval_duration": 4,
                "eval_duration": 3
            }),
        )]);
        let provider = server.provider();
        let request = GenerationRequest {
            system_prompt: Some("Be concise".to_owned()),
            parameters: GenerationParameters {
                temperature: Some(0.2),
                top_p: Some(0.9),
                top_k: Some(20),
                max_tokens: Some(32),
                repeat_penalty: Some(1.1),
                ..GenerationParameters::default()
            },
            stop_sequences: vec!["END".to_owned()],
            seed: Some(7),
            tools: vec![ToolDefinition {
                name: "lookup".to_owned(),
                description: Some("Look up a value".to_owned()),
                parameters: json!({"type": "object"}),
            }],
            response_format: ResponseFormat::JsonObject,
            tool_policy: ToolPolicy::Auto,
            ..chat_request()
        };
        let response = provider
            .generate(&request, &CancellationToken::new())
            .unwrap();
        assert_eq!(response.text, "hello");
        assert_eq!(response.usage.unwrap().total_tokens, Some(6));
        assert_eq!(response.timing.unwrap().total_duration_ns, Some(10));
        assert_eq!(response.finish_reason.as_deref(), Some("stop"));
        let request_text = &server.requests()[0];
        let body = request_text.split("\r\n\r\n").nth(1).unwrap();
        let body: Value = serde_json::from_str(body).unwrap();
        assert_eq!(body["stream"], false);
        assert_eq!(body["format"], "json");
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["options"]["num_predict"], 32);
        assert_eq!(body["options"]["seed"], 7);
        assert_eq!(body["tools"][0]["function"]["name"], "lookup");
    }

    #[test]
    fn text_generation_uses_generate_endpoint() {
        let server = MockServer::start(vec![MockReply::Json(
            200,
            json!({"model": "model", "response": "text", "done": true}),
        )]);
        let provider = server.provider();
        let request = GenerationRequest {
            model: "model".to_owned(),
            prompt: Some("prompt".to_owned()),
            ..GenerationRequest::default()
        };
        assert_eq!(
            provider
                .generate(&request, &CancellationToken::new())
                .unwrap()
                .text,
            "text"
        );
        assert!(server.requests()[0].starts_with("POST /api/generate HTTP/1.1"));
    }

    #[test]
    fn streaming_emits_ndjson_and_final_metrics() {
        let server = MockServer::start(vec![MockReply::Chunked(
            200,
            vec![
                json!({"model": "model", "message": {"role": "assistant", "content": "hel"}, "done": false}).to_string(),
                json!({"model": "model", "message": {"role": "assistant", "content": "lo"}, "done": true, "done_reason": "stop", "eval_count": 2, "total_duration": 9}).to_string(),
            ],
            None,
        )]);
        let provider = server.provider();
        let mut chunks = Vec::new();
        let response = provider
            .stream(&chat_request(), &CancellationToken::new(), &mut |chunk| {
                chunks.push(chunk);
                Ok(())
            })
            .unwrap();
        assert_eq!(chunks.len(), 2);
        assert_eq!(response.text, "hello");
        assert_eq!(response.usage.unwrap().completion_tokens, Some(2));
        assert!(chunks[1].done);
    }

    #[test]
    fn slow_streaming_within_deadline_is_supported() {
        let server = MockServer::start(vec![MockReply::Chunked(
            200,
            vec![
                json!({"model": "model", "message": {"content": "hel"}, "done": false}).to_string(),
                json!({"model": "model", "message": {"content": "lo"}, "done": true}).to_string(),
            ],
            Some(Duration::from_millis(75)),
        )]);
        let provider = server.provider_with_deadline(10, 250);

        let response = provider
            .stream(&chat_request(), &CancellationToken::new(), &mut |_| Ok(()))
            .unwrap();
        assert_eq!(response.text, "hello");
    }

    #[test]
    fn streaming_response_size_is_bounded() {
        let content = "x".repeat(MAX_HTTP_LINE_BYTES - 128);
        let line = json!({"model": "model", "response": content, "done": false}).to_string();
        assert!(line.len() <= MAX_HTTP_LINE_BYTES);
        let lines = vec![line; MAX_STREAMED_RESPONSE_BYTES / content.len() + 2];
        let server = MockServer::start(vec![MockReply::Chunked(200, lines, None)]);

        assert!(matches!(
            server
                .provider()
                .stream(&chat_request(), &CancellationToken::new(), &mut |_| Ok(())),
            Err(RuntimeError::Protocol { message })
                if message.contains("streamed response exceeded")
        ));
    }

    #[test]
    fn line_and_body_limits_are_enforced() {
        let mut line = Cursor::new(vec![b'x'; MAX_HTTP_LINE_BYTES + 1]);
        assert!(matches!(
            super::read_line_with_cancel(
                &mut line,
                &CancellationToken::new(),
                Instant::now() + Duration::from_secs(1),
            ),
            Err(RuntimeError::Protocol { message })
                if message.contains("oversized HTTP/NDJSON line")
        ));

        let mut body = Cursor::new(b"12345".to_vec());
        assert!(matches!(
            super::read_body_string_with_limit(
                &mut body,
                &CancellationToken::new(),
                Instant::now() + Duration::from_secs(1),
                4,
            ),
            Err(RuntimeError::Protocol { message })
                if message.contains("response exceeded the local size limit")
        ));
    }

    #[test]
    fn malformed_response_is_a_protocol_error() {
        let server = MockServer::start(vec![MockReply::Raw(200, "not-json".to_owned())]);
        assert!(matches!(
            server.provider().health(),
            Err(RuntimeError::Protocol { .. })
        ));
    }

    #[test]
    fn unavailable_runtime_is_typed() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let provider = OllamaProvider::new(OllamaConfig {
            endpoint: format!("http://127.0.0.1:{port}"),
            connect_timeout_ms: 100,
            read_timeout_ms: 20,
            read_deadline_ms: 100,
        })
        .unwrap();
        assert!(matches!(
            provider.health(),
            Err(RuntimeError::Unavailable { .. })
        ));
    }

    #[test]
    fn unsupported_parameter_is_rejected_before_network() {
        let provider = OllamaProvider::default_local().unwrap();
        let request = GenerationRequest {
            parameters: GenerationParameters {
                presence_penalty: Some(0.4),
                ..GenerationParameters::default()
            },
            ..chat_request()
        };
        assert_eq!(
            provider.generate(&request, &CancellationToken::new()),
            Err(RuntimeError::UnsupportedParameter {
                parameter: crate::runtime::GenerationParameter::PresencePenalty
            })
        );
    }

    #[test]
    fn model_not_found_and_remote_errors_are_distinguished() {
        let server = MockServer::start(vec![
            MockReply::Json(404, json!({"error": "model missing not found"})),
            MockReply::Json(503, json!({"error": "runtime overloaded"})),
        ]);
        let provider = server.provider();
        assert_eq!(
            provider.model_info("missing").unwrap_err(),
            RuntimeError::ModelNotFound {
                model: "missing".to_owned()
            }
        );
        assert_eq!(
            provider.health().unwrap_err(),
            RuntimeError::Remote {
                status: 503,
                message: "runtime overloaded".to_owned()
            }
        );
    }

    #[test]
    fn cancellation_stops_stream_without_waiting_for_completion() {
        let server = MockServer::start(vec![MockReply::Chunked(
            200,
            vec![
                json!({"model": "model", "message": {"content": "first"}, "done": false})
                    .to_string(),
                json!({"model": "model", "message": {"content": "second"}, "done": true})
                    .to_string(),
            ],
            Some(Duration::from_millis(250)),
        )]);
        let provider = server.provider();
        let cancellation = CancellationToken::new();
        let callback_token = cancellation.clone();
        let result = provider.stream(&chat_request(), &cancellation, &mut |chunk| {
            if !chunk.done {
                callback_token.cancel();
            }
            Ok(())
        });
        assert_eq!(result, Err(RuntimeError::Cancelled));
    }

    #[test]
    fn silent_runtime_hits_total_read_deadline() {
        let server = MockServer::start(vec![MockReply::Silent]);
        let provider = server.provider_with_deadline(10, 100);
        let started = Instant::now();
        let result = provider.stream(&chat_request(), &CancellationToken::new(), &mut |_| Ok(()));

        assert!(matches!(
            result,
            Err(RuntimeError::Transport { message })
                if message.contains("read deadline exceeded")
        ));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn live_ollama_health_self_skips_when_unavailable() {
        let provider = OllamaProvider::default_local().unwrap();
        match provider.health() {
            Ok(health) => assert!(health.available),
            Err(RuntimeError::Unavailable { .. }) => {}
            Err(error) => panic!("live Ollama returned an unexpected error: {error}"),
        }
    }
}
