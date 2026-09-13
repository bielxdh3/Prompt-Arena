use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use crate::{
    ollama::{
        normalize_remote_error, read_body_string, read_line_with_cancel, OllamaConfig,
        OllamaProvider, MAX_LOCAL_MODEL_COUNT, MAX_LOCAL_MODEL_NAME_BYTES,
        MAX_STREAMED_RESPONSE_BYTES,
    },
    runtime::{
        CancellationToken, Capability, ChatMessage, GenerationChunk, GenerationParameter,
        GenerationRequest, GenerationResponse, MessageRole, ModelInfo, RuntimeCapabilities,
        RuntimeError, RuntimeHealth, RuntimeProvider, ToolCall, ToolPolicy, UsageMetrics,
    },
};

const MAX_SSE_EVENT_BYTES: usize = MAX_STREAMED_RESPONSE_BYTES;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenAiCompatibleRuntime {
    LmStudio,
    LlamaCpp,
}

impl OpenAiCompatibleRuntime {
    fn provider_id(self) -> &'static str {
        match self {
            Self::LmStudio => "lm_studio",
            Self::LlamaCpp => "llama_cpp",
        }
    }
}

#[derive(Debug, Clone)]
pub struct OpenAiCompatibleProvider {
    runtime: OpenAiCompatibleRuntime,
    transport: OllamaProvider,
}

impl OpenAiCompatibleProvider {
    pub fn new(
        runtime: OpenAiCompatibleRuntime,
        config: OllamaConfig,
    ) -> Result<Self, RuntimeError> {
        Ok(Self {
            runtime,
            transport: OllamaProvider::new(config)?,
        })
    }

    fn request_payload(
        &self,
        request: &GenerationRequest,
        stream: bool,
    ) -> Result<Value, RuntimeError> {
        self.negotiate(request)?;
        let mut messages = Vec::with_capacity(request.messages.len() + 1);
        if let Some(system_prompt) = &request.system_prompt {
            messages.push(openai_message(&ChatMessage {
                role: MessageRole::System,
                content: system_prompt.clone(),
                name: None,
                tool_call_id: None,
            }));
        }
        if let Some(prompt) = &request.prompt {
            messages.push(openai_message(&ChatMessage {
                role: MessageRole::User,
                content: prompt.clone(),
                name: None,
                tool_call_id: None,
            }));
        } else {
            messages.extend(request.messages.iter().map(openai_message));
        }

        let parameters = &request.parameters;
        let mut payload = Map::new();
        payload.insert("model".to_owned(), Value::String(request.model.clone()));
        payload.insert("messages".to_owned(), Value::Array(messages));
        payload.insert("stream".to_owned(), Value::Bool(stream));
        if let Some(value) = parameters.temperature {
            payload.insert("temperature".to_owned(), json!(value));
        }
        if let Some(value) = parameters.top_p {
            payload.insert("top_p".to_owned(), json!(value));
        }
        if let Some(value) = parameters.max_tokens {
            payload.insert("max_tokens".to_owned(), json!(value));
        }
        if !request.stop_sequences.is_empty() {
            payload.insert("stop".to_owned(), json!(request.stop_sequences));
        }
        if let Some(value) = request.seed {
            payload.insert("seed".to_owned(), json!(value));
        }
        if !request.tools.is_empty() {
            payload.insert(
                "tools".to_owned(),
                Value::Array(request.tools.iter().map(openai_tool).collect()),
            );
        }
        match &request.tool_policy {
            ToolPolicy::None => {}
            ToolPolicy::Auto => {
                payload.insert("tool_choice".to_owned(), Value::String("auto".to_owned()));
            }
            ToolPolicy::Required => {
                payload.insert(
                    "tool_choice".to_owned(),
                    Value::String("required".to_owned()),
                );
            }
            ToolPolicy::Named(name) => {
                payload.insert(
                    "tool_choice".to_owned(),
                    json!({"type": "function", "function": {"name": name}}),
                );
            }
        }
        Ok(Value::Object(payload))
    }
}

impl RuntimeProvider for OpenAiCompatibleProvider {
    fn provider_id(&self) -> &'static str {
        self.runtime.provider_id()
    }

    fn endpoint(&self) -> &str {
        self.transport.endpoint()
    }

    fn capabilities(&self) -> RuntimeCapabilities {
        RuntimeCapabilities {
            capabilities: BTreeSet::from([
                Capability::Chat,
                Capability::TextGeneration,
                Capability::Streaming,
                Capability::ModelListing,
                Capability::Cancellation,
                Capability::UsageMetrics,
                Capability::ToolCalling,
            ]),
            parameters: BTreeSet::from([
                GenerationParameter::Temperature,
                GenerationParameter::TopP,
                GenerationParameter::MaxTokens,
                GenerationParameter::StopSequences,
                GenerationParameter::Seed,
                GenerationParameter::Tools,
                GenerationParameter::ToolPolicy,
            ]),
        }
    }

    fn health(&self) -> Result<RuntimeHealth, RuntimeError> {
        self.list_models()?;
        Ok(RuntimeHealth {
            provider: self.provider_id().to_owned(),
            endpoint: self.endpoint().to_owned(),
            available: true,
            version: None,
        })
    }

    fn list_models(&self) -> Result<Vec<ModelInfo>, RuntimeError> {
        let cancellation = CancellationToken::new();
        let value = self
            .transport
            .json_request("GET", "/v1/models", None, &cancellation)?;
        let mut models = parse_openai_model_info(&value)?;
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
        self.list_models()?
            .into_iter()
            .find(|candidate| candidate.name == model)
            .ok_or_else(|| RuntimeError::ModelNotFound {
                model: model.to_owned(),
            })
    }

    fn generate(
        &self,
        request: &GenerationRequest,
        cancellation: &CancellationToken,
    ) -> Result<GenerationResponse, RuntimeError> {
        let payload = self.request_payload(request, false)?;
        let response =
            self.transport
                .request("POST", "/v1/chat/completions", Some(&payload), cancellation)?;
        let status = response.status;
        let read_deadline = response.read_deadline;
        let body = read_body_string(response.body, cancellation, read_deadline)?;
        if !(200..300).contains(&status) {
            return Err(normalize_remote_error(status, &body, Some(&request.model)));
        }
        let value: Value = serde_json::from_str(&body).map_err(|error| RuntimeError::Protocol {
            message: format!("runtime returned malformed chat JSON: {error}"),
        })?;
        parse_chat_response(&value, &request.model)
    }

    fn stream(
        &self,
        request: &GenerationRequest,
        cancellation: &CancellationToken,
        on_chunk: &mut dyn FnMut(GenerationChunk) -> Result<(), RuntimeError>,
    ) -> Result<GenerationResponse, RuntimeError> {
        let payload = self.request_payload(request, true)?;
        let response =
            self.transport
                .request("POST", "/v1/chat/completions", Some(&payload), cancellation)?;
        let status = response.status;
        let read_deadline = response.read_deadline;
        if !(200..300).contains(&status) {
            let body = read_body_string(response.body, cancellation, read_deadline)?;
            return Err(normalize_remote_error(status, &body, Some(&request.model)));
        }

        let mut body = response.body;
        let mut event_data = Vec::new();
        let mut streamed_bytes = 0_usize;
        let mut accumulated_text = String::new();
        let mut tool_calls = BTreeMap::new();
        let mut finish_reason = None;
        let mut usage = None;
        let mut model = request.model.clone();
        let mut saw_done = false;

        loop {
            let line = read_line_with_cancel(&mut body, cancellation, read_deadline)?;
            let Some(line) = line else {
                if !event_data.is_empty() {
                    let data = event_data.join("\n");
                    event_data.clear();
                    saw_done = apply_stream_event(
                        parse_sse_event(&data, &request.model)?,
                        &mut accumulated_text,
                        &mut tool_calls,
                        &mut finish_reason,
                        &mut usage,
                        &mut model,
                        on_chunk,
                    )?;
                }
                break;
            };
            streamed_bytes = streamed_bytes.saturating_add(line.len());
            if streamed_bytes > MAX_SSE_EVENT_BYTES {
                return Err(RuntimeError::Protocol {
                    message: "runtime SSE response exceeded the local size limit".to_owned(),
                });
            }
            if line.is_empty() {
                if event_data.is_empty() {
                    continue;
                }
                let data = event_data.join("\n");
                event_data.clear();
                if apply_stream_event(
                    parse_sse_event(&data, &request.model)?,
                    &mut accumulated_text,
                    &mut tool_calls,
                    &mut finish_reason,
                    &mut usage,
                    &mut model,
                    on_chunk,
                )? {
                    saw_done = true;
                    break;
                }
                continue;
            }
            if line.starts_with(':') || line.starts_with("event:") || line.starts_with("id:") {
                continue;
            }
            if let Some(data) = line.strip_prefix("data:") {
                event_data.push(data.strip_prefix(' ').unwrap_or(data).to_owned());
            } else {
                return Err(RuntimeError::Protocol {
                    message: "runtime returned an unsupported SSE field".to_owned(),
                });
            }
        }

        if !saw_done {
            return Err(RuntimeError::Protocol {
                message: "runtime SSE stream ended before [DONE]".to_owned(),
            });
        }
        Ok(GenerationResponse {
            model,
            text: accumulated_text,
            tool_calls: finalize_tool_calls(tool_calls)?,
            finish_reason,
            usage,
            timing: None,
            metadata: BTreeMap::new(),
        })
    }
}

fn openai_message(message: &ChatMessage) -> Value {
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

fn openai_tool(tool: &crate::runtime::ToolDefinition) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters,
        }
    })
}

fn parse_chat_response(
    value: &Value,
    requested_model: &str,
) -> Result<GenerationResponse, RuntimeError> {
    let object = value.as_object().ok_or_else(|| RuntimeError::Protocol {
        message: "runtime chat response was not an object".to_owned(),
    })?;
    let choices = object
        .get("choices")
        .and_then(Value::as_array)
        .ok_or_else(|| RuntimeError::Protocol {
            message: "runtime chat response did not contain choices".to_owned(),
        })?;
    let choice = choices.first().ok_or_else(|| RuntimeError::Protocol {
        message: "runtime chat response contained no choices".to_owned(),
    })?;
    let choice = choice.as_object().ok_or_else(|| RuntimeError::Protocol {
        message: "runtime chat choice was not an object".to_owned(),
    })?;
    let message = choice
        .get("message")
        .and_then(Value::as_object)
        .ok_or_else(|| RuntimeError::Protocol {
            message: "runtime chat response did not contain a message".to_owned(),
        })?;
    let text = message_content(message.get("content"))?;
    let tool_calls = message
        .get("tool_calls")
        .map(parse_tool_calls)
        .transpose()?
        .unwrap_or_default();
    Ok(GenerationResponse {
        model: object
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or(requested_model)
            .to_owned(),
        text,
        tool_calls,
        finish_reason: choice
            .get("finish_reason")
            .and_then(Value::as_str)
            .map(str::to_owned),
        usage: parse_openai_usage(object.get("usage"))?,
        timing: None,
        metadata: BTreeMap::new(),
    })
}

fn message_content(value: Option<&Value>) -> Result<String, RuntimeError> {
    match value {
        None | Some(Value::Null) => Ok(String::new()),
        Some(Value::String(content)) => Ok(content.clone()),
        Some(_) => Err(RuntimeError::Protocol {
            message: "runtime chat content used an unsupported shape".to_owned(),
        }),
    }
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
            let arguments = match function.get("arguments") {
                None => Value::Object(Map::new()),
                Some(Value::String(arguments)) if arguments.is_empty() => Value::Object(Map::new()),
                Some(Value::String(arguments)) => {
                    serde_json::from_str(arguments).map_err(|_| RuntimeError::Protocol {
                        message: "runtime tool call arguments were not valid JSON".to_owned(),
                    })?
                }
                Some(value) => value.clone(),
            };
            Ok(ToolCall {
                id: object.get("id").and_then(Value::as_str).map(str::to_owned),
                name: name.to_owned(),
                arguments,
            })
        })
        .collect()
}

fn parse_openai_usage(value: Option<&Value>) -> Result<Option<UsageMetrics>, RuntimeError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let object = value.as_object().ok_or_else(|| RuntimeError::Protocol {
        message: "runtime usage was not an object".to_owned(),
    })?;
    let prompt_tokens = object.get("prompt_tokens").and_then(Value::as_u64);
    let completion_tokens = object.get("completion_tokens").and_then(Value::as_u64);
    let total_tokens = object.get("total_tokens").and_then(Value::as_u64);
    if prompt_tokens.is_none() && completion_tokens.is_none() && total_tokens.is_none() {
        return Ok(None);
    }
    Ok(Some(UsageMetrics {
        prompt_tokens,
        completion_tokens,
        total_tokens,
    }))
}

#[derive(Debug)]
enum OpenAiStreamEvent {
    Done,
    Chunk {
        model: Option<String>,
        text: String,
        finish_reason: Option<String>,
        usage: Option<UsageMetrics>,
        tool_calls: Vec<StreamToolCall>,
    },
}

#[derive(Debug, Clone)]
struct StreamToolCall {
    index: u64,
    id: Option<String>,
    name: Option<String>,
    arguments: Option<String>,
}

fn parse_sse_event(data: &str, requested_model: &str) -> Result<OpenAiStreamEvent, RuntimeError> {
    if data.trim() == "[DONE]" {
        return Ok(OpenAiStreamEvent::Done);
    }
    let value: Value = serde_json::from_str(data).map_err(|error| RuntimeError::Protocol {
        message: format!("runtime returned malformed SSE JSON: {error}"),
    })?;
    let object = value.as_object().ok_or_else(|| RuntimeError::Protocol {
        message: "runtime SSE item was not an object".to_owned(),
    })?;
    let choices = object
        .get("choices")
        .and_then(Value::as_array)
        .ok_or_else(|| RuntimeError::Protocol {
            message: "runtime SSE item did not contain choices".to_owned(),
        })?;
    let mut text = String::new();
    let mut finish_reason = None;
    let mut tool_calls = Vec::new();
    for (position, choice) in choices.iter().enumerate() {
        let choice = choice.as_object().ok_or_else(|| RuntimeError::Protocol {
            message: "runtime SSE choice was not an object".to_owned(),
        })?;
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            finish_reason = Some(reason.to_owned());
        }
        let delta = choice
            .get("delta")
            .and_then(Value::as_object)
            .ok_or_else(|| RuntimeError::Protocol {
                message: "runtime SSE choice did not contain a delta".to_owned(),
            })?;
        text.push_str(&message_content(delta.get("content"))?);
        if let Some(calls) = delta.get("tool_calls") {
            let calls = calls.as_array().ok_or_else(|| RuntimeError::Protocol {
                message: "runtime SSE tool_calls was not an array".to_owned(),
            })?;
            for (call_position, call) in calls.iter().enumerate() {
                let call = call.as_object().ok_or_else(|| RuntimeError::Protocol {
                    message: "runtime SSE tool call was not an object".to_owned(),
                })?;
                let function =
                    call.get("function")
                        .and_then(Value::as_object)
                        .ok_or_else(|| RuntimeError::Protocol {
                            message: "runtime SSE tool call had no function object".to_owned(),
                        })?;
                let index = call
                    .get("index")
                    .and_then(Value::as_u64)
                    .unwrap_or((position + call_position) as u64);
                let arguments = match function.get("arguments") {
                    None => None,
                    Some(Value::String(arguments)) => Some(arguments.clone()),
                    Some(_) => {
                        return Err(RuntimeError::Protocol {
                            message: "runtime SSE tool arguments were not text".to_owned(),
                        })
                    }
                };
                tool_calls.push(StreamToolCall {
                    index,
                    id: call.get("id").and_then(Value::as_str).map(str::to_owned),
                    name: function
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    arguments,
                });
            }
        }
    }
    if choices.is_empty() && object.get("usage").is_none() {
        return Err(RuntimeError::Protocol {
            message: "runtime SSE item had neither choices nor usage".to_owned(),
        });
    }
    Ok(OpenAiStreamEvent::Chunk {
        model: object
            .get("model")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| Some(requested_model.to_owned())),
        text,
        finish_reason,
        usage: parse_openai_usage(object.get("usage"))?,
        tool_calls,
    })
}

fn apply_stream_event(
    event: OpenAiStreamEvent,
    accumulated_text: &mut String,
    tool_calls: &mut BTreeMap<u64, StreamToolCall>,
    finish_reason: &mut Option<String>,
    usage: &mut Option<UsageMetrics>,
    model: &mut String,
    on_chunk: &mut dyn FnMut(GenerationChunk) -> Result<(), RuntimeError>,
) -> Result<bool, RuntimeError> {
    match event {
        OpenAiStreamEvent::Done => {
            on_chunk(GenerationChunk {
                text: String::new(),
                done: true,
                tool_calls: finalize_tool_calls(tool_calls.clone())?,
                metadata: BTreeMap::new(),
            })?;
            Ok(true)
        }
        OpenAiStreamEvent::Chunk {
            model: event_model,
            text,
            finish_reason: event_finish_reason,
            usage: event_usage,
            tool_calls: event_tool_calls,
        } => {
            if let Some(event_model) = event_model {
                *model = event_model;
            }
            accumulated_text.push_str(&text);
            if event_finish_reason.is_some() {
                *finish_reason = event_finish_reason.clone();
            }
            if event_usage.is_some() {
                *usage = event_usage;
            }
            for event_tool_call in event_tool_calls {
                let entry =
                    tool_calls
                        .entry(event_tool_call.index)
                        .or_insert_with(|| StreamToolCall {
                            index: event_tool_call.index,
                            id: None,
                            name: None,
                            arguments: None,
                        });
                if event_tool_call.id.is_some() {
                    entry.id = event_tool_call.id;
                }
                if event_tool_call.name.is_some() {
                    entry.name = event_tool_call.name;
                }
                if let Some(arguments) = event_tool_call.arguments {
                    entry
                        .arguments
                        .get_or_insert_with(String::new)
                        .push_str(&arguments);
                }
            }
            if !text.is_empty() || finish_reason.is_some() || !tool_calls.is_empty() {
                on_chunk(GenerationChunk {
                    text,
                    done: false,
                    tool_calls: Vec::new(),
                    metadata: BTreeMap::new(),
                })?;
            }
            Ok(false)
        }
    }
}

fn finalize_tool_calls(
    tool_calls: BTreeMap<u64, StreamToolCall>,
) -> Result<Vec<ToolCall>, RuntimeError> {
    tool_calls
        .into_values()
        .map(|call| {
            let name = call.name.ok_or_else(|| RuntimeError::Protocol {
                message: "runtime tool call ended without a function name".to_owned(),
            })?;
            let arguments = match call.arguments.as_deref() {
                None | Some("") => Value::Object(Map::new()),
                Some(arguments) => {
                    serde_json::from_str(arguments).map_err(|_| RuntimeError::Protocol {
                        message: "runtime streamed tool arguments were not valid JSON".to_owned(),
                    })?
                }
            };
            Ok(ToolCall {
                id: call.id,
                name,
                arguments,
            })
        })
        .collect()
}

pub(crate) fn parse_openai_model_info(value: &Value) -> Result<Vec<ModelInfo>, RuntimeError> {
    let models = value
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| value.get("models").and_then(Value::as_array))
        .ok_or_else(|| RuntimeError::Protocol {
            message: "local model source did not contain a model array".to_owned(),
        })?;
    if models.len() > MAX_LOCAL_MODEL_COUNT {
        return Err(RuntimeError::Protocol {
            message: "runtime model list exceeded the local item limit".to_owned(),
        });
    }
    models.iter().map(parse_openai_model).collect()
}

fn parse_openai_model(value: &Value) -> Result<ModelInfo, RuntimeError> {
    let object = value.as_object().ok_or_else(|| RuntimeError::Protocol {
        message: "local model source returned a non-object model".to_owned(),
    })?;
    let details = object.get("details").and_then(Value::as_object);
    let name =
        first_string(object, &["id", "name", "model"]).ok_or_else(|| RuntimeError::Protocol {
            message: "local model source returned a model without an identity".to_owned(),
        })?;
    let mut metadata = BTreeMap::new();
    for (key, value) in object {
        if !matches!(
            key.as_str(),
            "id" | "name"
                | "model"
                | "digest"
                | "sha256"
                | "hash"
                | "size"
                | "size_bytes"
                | "modified_at"
                | "updated_at"
                | "family"
                | "parameter_size"
                | "parameterSize"
                | "quantization_level"
                | "quantizationLevel"
                | "context_length"
                | "contextLength"
                | "details"
        ) {
            metadata.insert(key.clone(), value.clone());
        }
    }
    if let Some(details) = object.get("details") {
        metadata.insert("details".to_owned(), details.clone());
    }

    let model = ModelInfo {
        name,
        digest: first_string(object, &["digest", "sha256", "hash"]),
        size_bytes: first_u64(object, &["size_bytes", "size"]),
        modified_at: first_string(object, &["modified_at", "updated_at"]),
        family: first_string(object, &["family"])
            .or_else(|| details.and_then(|details| first_string(details, &["family"]))),
        parameter_size: first_string(object, &["parameter_size", "parameterSize"])
            .or_else(|| details.and_then(|details| first_string(details, &["parameter_size"]))),
        quantization_level: first_string(object, &["quantization_level", "quantizationLevel"])
            .or_else(|| details.and_then(|details| first_string(details, &["quantization_level"]))),
        context_length: first_u64(object, &["context_length", "contextLength"])
            .or_else(|| details.and_then(|details| first_u64(details, &["context_length"]))),
        metadata,
    };
    crate::ollama::validate_model_info(&model)?;
    Ok(model)
}

fn first_string(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str).map(str::to_owned))
}

fn first_u64(object: &Map<String, Value>, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_u64))
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::atomic::{AtomicU64, Ordering},
        thread,
        time::Duration,
    };

    use serde_json::json;

    use super::*;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct MockServer {
        endpoint: String,
        handle: Option<thread::JoinHandle<()>>,
    }

    impl MockServer {
        fn start(replies: Vec<(String, Option<Duration>)>) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let handle = thread::spawn(move || {
                for (response, delay) in replies {
                    let Ok((mut stream, _)) = listener.accept() else {
                        return;
                    };
                    stream
                        .set_read_timeout(Some(Duration::from_secs(2)))
                        .unwrap();
                    read_request(&mut stream);
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                    if let Some(delay) = delay {
                        thread::sleep(delay);
                    }
                }
            });
            Self {
                endpoint: format!("http://127.0.0.1:{port}"),
                handle: Some(handle),
            }
        }

        fn provider(&self) -> OpenAiCompatibleProvider {
            OpenAiCompatibleProvider::new(
                OpenAiCompatibleRuntime::LmStudio,
                OllamaConfig {
                    endpoint: self.endpoint.clone(),
                    connect_timeout_ms: 1_000,
                    read_timeout_ms: 20,
                    read_deadline_ms: 2_000,
                },
            )
            .unwrap()
        }
    }

    impl Drop for MockServer {
        fn drop(&mut self) {
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
        }
    }

    fn read_request(stream: &mut TcpStream) {
        let mut bytes = Vec::new();
        let mut one = [0_u8; 1];
        while !bytes.ends_with(b"\r\n\r\n") {
            if stream.read_exact(&mut one).is_err() {
                return;
            }
            bytes.push(one[0]);
        }
        let headers = String::from_utf8_lossy(&bytes);
        let length = headers
            .lines()
            .find_map(|line| {
                line.strip_prefix("Content-Length:")?
                    .trim()
                    .parse::<usize>()
                    .ok()
            })
            .unwrap_or(0);
        let mut body = vec![0_u8; length];
        let _ = stream.read_exact(&mut body);
    }

    fn response(status: u16, content_type: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status} OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn request() -> GenerationRequest {
        GenerationRequest {
            model: "local-model".to_owned(),
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
    fn model_listing_uses_openai_models_endpoint_and_normalizes_profiles() {
        let body = serde_json::to_string(&json!({
            "data": [
                {"id": "zeta", "owned_by": "local"},
                {"id": "alpha", "owned_by": "local", "context_length": 4096}
            ]
        }))
        .unwrap();
        let server = MockServer::start(vec![(response(200, "application/json", &body), None)]);
        let models = server.provider().list_models().unwrap();
        assert_eq!(
            models
                .iter()
                .map(|model| model.name.as_str())
                .collect::<Vec<_>>(),
            ["alpha", "zeta"]
        );
        assert_eq!(models[0].context_length, Some(4096));
        assert!(server
            .provider()
            .capabilities()
            .supports(Capability::ModelListing));
        assert_ne!(server.provider().provider_id(), "ollama");
        let _ = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    }

    #[test]
    fn chat_stream_maps_sse_text_finish_reason_usage_and_done() {
        let body = concat!(
            "data: {\"model\":\"local-model\",\"choices\":[{\"delta\":{\"content\":\"hel\"},\"finish_reason\":null}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\n",
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":4,\"completion_tokens\":2,\"total_tokens\":6}}\n\n",
            "data: [DONE]\n\n"
        );
        let server = MockServer::start(vec![(response(200, "text/event-stream", body), None)]);
        let mut chunks = Vec::new();
        let result = server
            .provider()
            .stream(&request(), &CancellationToken::new(), &mut |chunk| {
                chunks.push(chunk);
                Ok(())
            })
            .unwrap();
        assert_eq!(result.text, "hello");
        assert_eq!(result.finish_reason.as_deref(), Some("stop"));
        assert_eq!(
            result.usage,
            Some(UsageMetrics {
                prompt_tokens: Some(4),
                completion_tokens: Some(2),
                total_tokens: Some(6)
            })
        );
        assert!(chunks.last().unwrap().done);
    }

    #[test]
    fn chat_errors_are_typed_and_unsupported_metrics_are_not_fabricated() {
        let server = MockServer::start(vec![(
            response(503, "application/json", r#"{"error":"busy"}"#),
            None,
        )]);
        assert_eq!(
            server
                .provider()
                .generate(&request(), &CancellationToken::new()),
            Err(RuntimeError::Remote {
                status: 503,
                message: "busy".to_owned()
            })
        );

        let body = r#"{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}],"model":"local-model"}"#;
        let server = MockServer::start(vec![(response(200, "application/json", body), None)]);
        let result = server
            .provider()
            .generate(&request(), &CancellationToken::new())
            .unwrap();
        assert_eq!(result.timing, None);
        assert_eq!(result.usage, None);
    }

    #[test]
    fn chat_stream_cancellation_propagates_after_first_chunk() {
        let body = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"first\"},\"finish_reason\":null}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"second\"},\"finish_reason\":\"stop\"}]}\n\n",
            "data: [DONE]\n\n"
        );
        let server = MockServer::start(vec![(
            response(200, "text/event-stream", body),
            Some(Duration::from_millis(100)),
        )]);
        let cancellation = CancellationToken::new();
        let callback_cancellation = cancellation.clone();
        let result = server
            .provider()
            .stream(&request(), &cancellation, &mut |chunk| {
                if !chunk.text.is_empty() {
                    callback_cancellation.cancel();
                }
                Ok(())
            });
        assert_eq!(result, Err(RuntimeError::Cancelled));
    }
}
