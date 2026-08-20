use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: MessageRole,
    pub content: String,
    pub name: Option<String>,
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationParameters {
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub top_k: Option<u32>,
    pub max_tokens: Option<u32>,
    pub repeat_penalty: Option<f32>,
    pub presence_penalty: Option<f32>,
    pub frequency_penalty: Option<f32>,
}

impl Default for GenerationParameters {
    fn default() -> Self {
        Self {
            temperature: None,
            top_p: None,
            top_k: None,
            max_tokens: None,
            repeat_penalty: None,
            presence_penalty: None,
            frequency_penalty: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub name: String,
    pub description: Option<String>,
    pub parameters: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ToolPolicy {
    None,
    Auto,
    Required,
    Named(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ResponseFormat {
    Text,
    #[serde(rename = "json_object")]
    JsonObject,
    #[serde(rename = "json_schema")]
    JsonSchema(Value),
}

impl Default for ResponseFormat {
    fn default() -> Self {
        Self::Text
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRequest {
    pub model: String,
    pub prompt: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub system_prompt: Option<String>,
    pub parameters: GenerationParameters,
    pub stop_sequences: Vec<String>,
    pub seed: Option<u64>,
    pub tools: Vec<ToolDefinition>,
    pub tool_policy: ToolPolicy,
    pub response_format: ResponseFormat,
    pub metadata: BTreeMap<String, Value>,
}

impl Default for GenerationRequest {
    fn default() -> Self {
        Self {
            model: String::new(),
            prompt: None,
            messages: Vec::new(),
            system_prompt: None,
            parameters: GenerationParameters::default(),
            stop_sequences: Vec::new(),
            seed: None,
            tools: Vec::new(),
            tool_policy: ToolPolicy::None,
            response_format: ResponseFormat::Text,
            metadata: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    Chat,
    TextGeneration,
    Streaming,
    ModelListing,
    ModelMetadata,
    ToolCalling,
    JsonResponseFormat,
    JsonSchemaResponseFormat,
    Cancellation,
    UsageMetrics,
    TimingMetrics,
}

impl fmt::Display for Capability {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Chat => "chat",
            Self::TextGeneration => "text_generation",
            Self::Streaming => "streaming",
            Self::ModelListing => "model_listing",
            Self::ModelMetadata => "model_metadata",
            Self::ToolCalling => "tool_calling",
            Self::JsonResponseFormat => "json_response_format",
            Self::JsonSchemaResponseFormat => "json_schema_response_format",
            Self::Cancellation => "cancellation",
            Self::UsageMetrics => "usage_metrics",
            Self::TimingMetrics => "timing_metrics",
        })
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum GenerationParameter {
    Temperature,
    TopP,
    TopK,
    MaxTokens,
    RepeatPenalty,
    PresencePenalty,
    FrequencyPenalty,
    StopSequences,
    Seed,
    Tools,
    ToolPolicy,
    ResponseFormat,
    Metadata,
}

impl fmt::Display for GenerationParameter {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Temperature => "temperature",
            Self::TopP => "top_p",
            Self::TopK => "top_k",
            Self::MaxTokens => "max_tokens",
            Self::RepeatPenalty => "repeat_penalty",
            Self::PresencePenalty => "presence_penalty",
            Self::FrequencyPenalty => "frequency_penalty",
            Self::StopSequences => "stop_sequences",
            Self::Seed => "seed",
            Self::Tools => "tools",
            Self::ToolPolicy => "tool_policy",
            Self::ResponseFormat => "response_format",
            Self::Metadata => "metadata",
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapabilities {
    pub capabilities: BTreeSet<Capability>,
    pub parameters: BTreeSet<GenerationParameter>,
}

impl RuntimeCapabilities {
    pub fn supports(&self, capability: Capability) -> bool {
        self.capabilities.contains(&capability)
    }

    pub fn supports_parameter(&self, parameter: GenerationParameter) -> bool {
        self.parameters.contains(&parameter)
    }

    pub fn validate_request(&self, request: &GenerationRequest) -> Result<(), RuntimeError> {
        request.validate_shape()?;

        if request.prompt.is_some() && !self.supports(Capability::TextGeneration) {
            return Err(RuntimeError::UnsupportedCapability {
                capability: Capability::TextGeneration,
            });
        }
        if !request.messages.is_empty() && !self.supports(Capability::Chat) {
            return Err(RuntimeError::UnsupportedCapability {
                capability: Capability::Chat,
            });
        }

        let parameters = &request.parameters;
        if parameters.temperature.is_some()
            && !self.supports_parameter(GenerationParameter::Temperature)
        {
            return Err(RuntimeError::UnsupportedParameter {
                parameter: GenerationParameter::Temperature,
            });
        }
        if parameters.top_p.is_some() && !self.supports_parameter(GenerationParameter::TopP) {
            return Err(RuntimeError::UnsupportedParameter {
                parameter: GenerationParameter::TopP,
            });
        }
        if parameters.top_k.is_some() && !self.supports_parameter(GenerationParameter::TopK) {
            return Err(RuntimeError::UnsupportedParameter {
                parameter: GenerationParameter::TopK,
            });
        }
        if parameters.max_tokens.is_some()
            && !self.supports_parameter(GenerationParameter::MaxTokens)
        {
            return Err(RuntimeError::UnsupportedParameter {
                parameter: GenerationParameter::MaxTokens,
            });
        }
        if parameters.repeat_penalty.is_some()
            && !self.supports_parameter(GenerationParameter::RepeatPenalty)
        {
            return Err(RuntimeError::UnsupportedParameter {
                parameter: GenerationParameter::RepeatPenalty,
            });
        }
        if parameters.presence_penalty.is_some()
            && !self.supports_parameter(GenerationParameter::PresencePenalty)
        {
            return Err(RuntimeError::UnsupportedParameter {
                parameter: GenerationParameter::PresencePenalty,
            });
        }
        if parameters.frequency_penalty.is_some()
            && !self.supports_parameter(GenerationParameter::FrequencyPenalty)
        {
            return Err(RuntimeError::UnsupportedParameter {
                parameter: GenerationParameter::FrequencyPenalty,
            });
        }
        if !request.stop_sequences.is_empty()
            && !self.supports_parameter(GenerationParameter::StopSequences)
        {
            return Err(RuntimeError::UnsupportedParameter {
                parameter: GenerationParameter::StopSequences,
            });
        }
        if request.seed.is_some() && !self.supports_parameter(GenerationParameter::Seed) {
            return Err(RuntimeError::UnsupportedParameter {
                parameter: GenerationParameter::Seed,
            });
        }
        if !request.tools.is_empty() {
            if !self.supports(Capability::ToolCalling) {
                return Err(RuntimeError::UnsupportedCapability {
                    capability: Capability::ToolCalling,
                });
            }
            if !self.supports_parameter(GenerationParameter::Tools) {
                return Err(RuntimeError::UnsupportedParameter {
                    parameter: GenerationParameter::Tools,
                });
            }
        }
        if !matches!(request.tool_policy, ToolPolicy::None)
            && !self.supports_parameter(GenerationParameter::ToolPolicy)
        {
            return Err(RuntimeError::UnsupportedParameter {
                parameter: GenerationParameter::ToolPolicy,
            });
        }
        match &request.response_format {
            ResponseFormat::Text => {}
            ResponseFormat::JsonObject => {
                if !self.supports(Capability::JsonResponseFormat) {
                    return Err(RuntimeError::UnsupportedCapability {
                        capability: Capability::JsonResponseFormat,
                    });
                }
                if !self.supports_parameter(GenerationParameter::ResponseFormat) {
                    return Err(RuntimeError::UnsupportedParameter {
                        parameter: GenerationParameter::ResponseFormat,
                    });
                }
            }
            ResponseFormat::JsonSchema(_) => {
                if !self.supports(Capability::JsonSchemaResponseFormat) {
                    return Err(RuntimeError::UnsupportedCapability {
                        capability: Capability::JsonSchemaResponseFormat,
                    });
                }
                if !self.supports_parameter(GenerationParameter::ResponseFormat) {
                    return Err(RuntimeError::UnsupportedParameter {
                        parameter: GenerationParameter::ResponseFormat,
                    });
                }
            }
        }
        if !request.metadata.is_empty() && !self.supports_parameter(GenerationParameter::Metadata) {
            return Err(RuntimeError::UnsupportedParameter {
                parameter: GenerationParameter::Metadata,
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealth {
    pub provider: String,
    pub endpoint: String,
    pub available: bool,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub name: String,
    pub digest: Option<String>,
    pub size_bytes: Option<u64>,
    pub modified_at: Option<String>,
    pub family: Option<String>,
    pub parameter_size: Option<String>,
    pub quantization_level: Option<String>,
    pub context_length: Option<u64>,
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: Option<String>,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsageMetrics {
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimingMetrics {
    pub total_duration_ns: Option<u64>,
    pub load_duration_ns: Option<u64>,
    pub prompt_eval_duration_ns: Option<u64>,
    pub eval_duration_ns: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationChunk {
    pub text: String,
    pub done: bool,
    pub tool_calls: Vec<ToolCall>,
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationResponse {
    pub model: String,
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    pub finish_reason: Option<String>,
    pub usage: Option<UsageMetrics>,
    pub timing: Option<TimingMetrics>,
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResponseSummary {
    pub model: String,
    pub finish_reason: Option<String>,
    pub response_text_byte_count: u64,
    pub tool_call_count: u64,
    pub usage: Option<UsageMetrics>,
    pub timing: Option<TimingMetrics>,
}

impl From<&GenerationResponse> for ResponseSummary {
    fn from(response: &GenerationResponse) -> Self {
        Self {
            model: response.model.clone(),
            finish_reason: response.finish_reason.clone(),
            response_text_byte_count: response.text.len() as u64,
            tool_call_count: response.tool_calls.len() as u64,
            usage: response.usage.clone(),
            timing: response.timing.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "kind", content = "detail")]
pub enum RuntimeError {
    Unavailable { message: String },
    InvalidConfiguration { message: String },
    UnsupportedCapability { capability: Capability },
    UnsupportedParameter { parameter: GenerationParameter },
    Transport { message: String },
    Protocol { message: String },
    ModelNotFound { model: String },
    Cancelled,
    Remote { status: u16, message: String },
}

pub type ProviderError = RuntimeError;

impl fmt::Display for RuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable { message } => write!(formatter, "runtime unavailable: {message}"),
            Self::InvalidConfiguration { message } => {
                write!(formatter, "runtime configuration is invalid: {message}")
            }
            Self::UnsupportedCapability { capability } => {
                write!(formatter, "runtime capability is unsupported: {capability}")
            }
            Self::UnsupportedParameter { parameter } => {
                write!(formatter, "runtime parameter is unsupported: {parameter}")
            }
            Self::Transport { message } => write!(formatter, "runtime transport failed: {message}"),
            Self::Protocol { message } => write!(formatter, "runtime protocol failed: {message}"),
            Self::ModelNotFound { model } => write!(formatter, "model was not found: {model}"),
            Self::Cancelled => formatter.write_str("runtime request was cancelled"),
            Self::Remote { status, message } => {
                write!(formatter, "runtime returned HTTP {status}: {message}")
            }
        }
    }
}

impl std::error::Error for RuntimeError {}

impl GenerationRequest {
    pub fn validate_shape(&self) -> Result<(), RuntimeError> {
        validate_model_name(&self.model)?;
        if self.prompt.is_none() && self.messages.is_empty() {
            return Err(RuntimeError::InvalidConfiguration {
                message: "a prompt or at least one message is required".to_owned(),
            });
        }
        if self.prompt.is_some() && !self.messages.is_empty() {
            return Err(RuntimeError::InvalidConfiguration {
                message: "prompt and messages cannot be supplied together".to_owned(),
            });
        }
        if self
            .stop_sequences
            .iter()
            .any(|sequence| sequence.is_empty())
        {
            return Err(RuntimeError::InvalidConfiguration {
                message: "stop sequences cannot be empty".to_owned(),
            });
        }
        if self.tools.iter().any(|tool| {
            tool.name.trim().is_empty()
                || tool.name.len() > 128
                || tool.name.chars().any(|character| character.is_control())
        }) {
            return Err(RuntimeError::InvalidConfiguration {
                message: "tool names must be non-empty and bounded".to_owned(),
            });
        }
        if matches!(
            self.tool_policy,
            ToolPolicy::Required | ToolPolicy::Named(_)
        ) && self.tools.is_empty()
        {
            return Err(RuntimeError::InvalidConfiguration {
                message: "a required tool policy needs at least one tool".to_owned(),
            });
        }
        if matches!(self.tool_policy, ToolPolicy::Named(ref name) if name.trim().is_empty()) {
            return Err(RuntimeError::InvalidConfiguration {
                message: "named tool policy needs a tool name".to_owned(),
            });
        }
        validate_finite_nonnegative(
            self.parameters.temperature,
            GenerationParameter::Temperature,
        )?;
        validate_unit_interval(self.parameters.top_p, GenerationParameter::TopP)?;
        validate_finite_nonnegative(
            self.parameters.repeat_penalty,
            GenerationParameter::RepeatPenalty,
        )?;
        validate_finite(
            self.parameters.presence_penalty,
            GenerationParameter::PresencePenalty,
        )?;
        validate_finite(
            self.parameters.frequency_penalty,
            GenerationParameter::FrequencyPenalty,
        )?;
        if self.parameters.top_k == Some(0) || self.parameters.max_tokens == Some(0) {
            return Err(RuntimeError::InvalidConfiguration {
                message: "top_k and max_tokens must be greater than zero".to_owned(),
            });
        }
        if let ResponseFormat::JsonSchema(schema) = &self.response_format {
            if !schema.is_object() {
                return Err(RuntimeError::InvalidConfiguration {
                    message: "JSON response schemas must be objects".to_owned(),
                });
            }
        }
        Ok(())
    }
}

fn validate_model_name(model: &str) -> Result<(), RuntimeError> {
    if model.trim().is_empty()
        || model.len() > 256
        || model.chars().any(|character| character.is_control())
    {
        return Err(RuntimeError::InvalidConfiguration {
            message: "model name must be non-empty and bounded".to_owned(),
        });
    }
    Ok(())
}

fn validate_finite(value: Option<f32>, parameter: GenerationParameter) -> Result<(), RuntimeError> {
    if value.is_some_and(|number| !number.is_finite()) {
        return Err(RuntimeError::InvalidConfiguration {
            message: format!("{parameter} must be finite"),
        });
    }
    Ok(())
}

fn validate_finite_nonnegative(
    value: Option<f32>,
    parameter: GenerationParameter,
) -> Result<(), RuntimeError> {
    validate_finite(value, parameter)?;
    if value.is_some_and(|number| number < 0.0) {
        return Err(RuntimeError::InvalidConfiguration {
            message: format!("{parameter} must be non-negative"),
        });
    }
    Ok(())
}

fn validate_unit_interval(
    value: Option<f32>,
    parameter: GenerationParameter,
) -> Result<(), RuntimeError> {
    validate_finite(value, parameter)?;
    if value.is_some_and(|number| !(0.0..=1.0).contains(&number)) {
        return Err(RuntimeError::InvalidConfiguration {
            message: format!("{parameter} must be between 0 and 1"),
        });
    }
    Ok(())
}

#[derive(Debug, Clone, Default)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

pub trait RuntimeProvider: Send + Sync {
    fn provider_id(&self) -> &'static str;
    fn endpoint(&self) -> &str;
    fn capabilities(&self) -> RuntimeCapabilities;
    fn health(&self) -> Result<RuntimeHealth, RuntimeError>;
    fn list_models(&self) -> Result<Vec<ModelInfo>, RuntimeError>;
    fn model_info(&self, model: &str) -> Result<ModelInfo, RuntimeError>;
    fn generate(
        &self,
        request: &GenerationRequest,
        cancellation: &CancellationToken,
    ) -> Result<GenerationResponse, RuntimeError>;
    fn stream(
        &self,
        request: &GenerationRequest,
        cancellation: &CancellationToken,
        on_chunk: &mut dyn FnMut(GenerationChunk) -> Result<(), RuntimeError>,
    ) -> Result<GenerationResponse, RuntimeError>;

    fn negotiate(&self, request: &GenerationRequest) -> Result<(), RuntimeError> {
        self.capabilities().validate_request(request)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Capability, GenerationParameter, GenerationRequest, RuntimeCapabilities, RuntimeError,
        ToolPolicy,
    };
    use std::collections::BTreeSet;

    #[test]
    fn request_shape_rejects_ambiguous_input() {
        let request = GenerationRequest {
            model: "model".to_owned(),
            prompt: Some("prompt".to_owned()),
            messages: vec![super::ChatMessage {
                role: super::MessageRole::User,
                content: "message".to_owned(),
                name: None,
                tool_call_id: None,
            }],
            ..GenerationRequest::default()
        };
        assert!(matches!(
            request.validate_shape(),
            Err(RuntimeError::InvalidConfiguration { .. })
        ));
    }

    #[test]
    fn capability_negotiation_distinguishes_unsupported_parameters() {
        let capabilities = RuntimeCapabilities {
            capabilities: BTreeSet::from([Capability::Chat]),
            parameters: BTreeSet::from([GenerationParameter::Temperature]),
        };
        let request = GenerationRequest {
            model: "model".to_owned(),
            messages: vec![super::ChatMessage {
                role: super::MessageRole::User,
                content: "message".to_owned(),
                name: None,
                tool_call_id: None,
            }],
            parameters: super::GenerationParameters {
                presence_penalty: Some(0.2),
                ..super::GenerationParameters::default()
            },
            ..GenerationRequest::default()
        };
        assert_eq!(
            capabilities.validate_request(&request),
            Err(RuntimeError::UnsupportedParameter {
                parameter: GenerationParameter::PresencePenalty
            })
        );
    }

    #[test]
    fn required_tool_policy_needs_tool_definitions() {
        let request = GenerationRequest {
            model: "model".to_owned(),
            prompt: Some("prompt".to_owned()),
            tool_policy: ToolPolicy::Required,
            ..GenerationRequest::default()
        };
        assert!(request.validate_shape().is_err());
    }
}
