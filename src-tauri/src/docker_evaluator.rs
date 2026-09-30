use std::{
    env,
    io::{Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::domain::{
    sha256_hex, DockerVerifierId, ObjectiveVerificationEvidence, ObjectiveVerifierKind,
};

pub const PINNED_PYTHON_IMAGE: &str = "docker.io/library/python:3.13-alpine3.22@sha256:e81548ac35b07a3bd4805f275107592ef458b1e893c0e04d45aedaa19416cca5";
pub const VERIFIER_CONTRACT_VERSION: u16 = 1;
const PLATFORM: &str = "linux/amd64";
const MAX_RESPONSE_BYTES: usize = 32 * 1024;
const MAX_CONTAINER_OUTPUT_BYTES: usize = 16 * 1024;
const COMMAND_OUTPUT_BYTES: usize = 16 * 1024;
const PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(8);
const CONTAINER_TIMEOUT: Duration = Duration::from_secs(20);
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(4);
const MAX_CONTRACT_OUTPUT_BYTES: usize = 2 * 1024;

const MISSING_USER_HARNESS: &str = r#"import json
import sys

limit = 32768
raw = sys.stdin.buffer.read(limit + 1)
result = {"status": "rejected", "passedTests": 0, "totalTests": 3}
if len(raw) <= limit:
    try:
        text = raw.decode("utf-8", "strict")
        folded = text.casefold()
        checks = [
            "not-found" in text,
            "return" in folded or "raise" in folded,
            "user" in folded and ("missing" in folded or "null" in folded),
        ]
        count = sum(checks)
        result = {"status": "passed" if count == len(checks) else "failed", "passedTests": count, "totalTests": len(checks)}
    except UnicodeDecodeError:
        pass
sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
"#;

const MISSING_RESOURCE_HARNESS: &str = r#"import json
import sys

limit = 32768
raw = sys.stdin.buffer.read(limit + 1)
result = {"status": "rejected", "passedTests": 0, "totalTests": 3}
if len(raw) <= limit:
    try:
        text = raw.decode("utf-8", "strict")
        folded = text.casefold()
        checks = [
            "not_found" in text,
            "404" in text,
            "json" in folded,
        ]
        count = sum(checks)
        result = {"status": "passed" if count == len(checks) else "failed", "passedTests": count, "totalTests": len(checks)}
    except UnicodeDecodeError:
        pass
sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
"#;

const FIXED_FUNCTION_PYTHON_HARNESS: &str = r#"import ast
import json
import sys

MAX_SOURCE_BYTES = 32768
TOTAL_TESTS = 8
SAFE_CALLS = {
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "int": int,
    "len": len,
    "list": list,
    "range": range,
    "str": str,
    "tuple": tuple,
}
SAFE_NODES = (
    ast.FunctionDef, ast.arguments, ast.arg, ast.Return, ast.If, ast.For,
    ast.Assign, ast.AugAssign, ast.Expr, ast.Pass, ast.Break, ast.Continue,
    ast.Name, ast.Load, ast.Store, ast.Constant, ast.List, ast.Tuple, ast.Dict,
    ast.Set, ast.Subscript, ast.Slice, ast.Attribute, ast.Call, ast.BoolOp,
    ast.BinOp, ast.UnaryOp, ast.Compare, ast.IfExp, ast.keyword, ast.And,
    ast.Or, ast.Not, ast.Add, ast.Sub, ast.Mult, ast.FloorDiv, ast.Mod,
    ast.UAdd, ast.USub, ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE,
    ast.In, ast.NotIn, ast.Is, ast.IsNot,
)


def emit(status, passed_tests):
    sys.stdout.write(json.dumps({
        "status": status,
        "passedTests": passed_tests,
        "totalTests": TOTAL_TESTS,
    }, separators=(",", ":")) + "\n")


def run():
    raw = sys.stdin.buffer.read(MAX_SOURCE_BYTES + 1)
    if len(raw) > MAX_SOURCE_BYTES:
        emit("rejected", 0)
        return
    try:
        source = raw.decode("utf-8", "strict")
        module = ast.parse(source, mode="exec")
        if len(module.body) != 1 or not isinstance(module.body[0], ast.FunctionDef):
            emit("rejected", 0)
            return
        function_node = module.body[0]
        args = function_node.args
        if (
            function_node.name != "find_user"
            or function_node.decorator_list
            or function_node.returns is not None
            or [arg.arg for arg in args.args] != ["users", "user_id"]
            or args.posonlyargs
            or args.vararg is not None
            or args.kwonlyargs
            or args.kwarg is not None
            or args.defaults
            or args.kw_defaults
            or any(arg.annotation is not None for arg in args.args)
        ):
            emit("rejected", 0)
            return
        valid = True
        for node in ast.walk(function_node):
            if not isinstance(node, SAFE_NODES):
                valid = False
                break
            if isinstance(node, ast.FunctionDef) and node is not function_node:
                valid = False
                break
            if isinstance(node, ast.Name) and node.id.startswith("_"):
                valid = False
                break
            if isinstance(node, ast.Attribute) and node.attr != "get":
                valid = False
                break
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    if node.func.id not in SAFE_CALLS:
                        valid = False
                        break
                elif not isinstance(node.func, ast.Attribute) or node.func.attr != "get":
                    valid = False
                    break
        if not valid:
            emit("rejected", 0)
            return

        namespace = {"__builtins__": SAFE_CALLS}
        exec(compile(module, "<fixed-function-challenge>", "exec"), namespace, namespace)
        find_user = namespace["find_user"]
        cases = [
            ([{"id": "u-1", "email": "one@example.invalid"}, {"id": "u-2", "email": "two@example.invalid"}], "u-2", {"id": "u-2", "email": "two@example.invalid"}),
            ([{"id": "u-1", "email": "one@example.invalid"}], "missing", None),
            ([{"id": 7, "kind": "integer"}, {"id": "7", "kind": "string"}], 7, {"id": 7, "kind": "integer"}),
            ([{"email": "no-id@example.invalid"}, {"id": "u-3", "rank": 1}, {"id": "u-3", "rank": 2}], "u-3", {"id": "u-3", "rank": 1}),
        ]
        passed = 0
        for users, user_id, expected in cases:
            original = json.loads(json.dumps(users, sort_keys=True))
            try:
                result = find_user(users, user_id)
            except BaseException:
                result = object()
            if result == expected:
                passed += 1
            if users == original:
                passed += 1
        emit("passed" if passed == TOTAL_TESTS else "failed", passed)
    except BaseException:
        emit("rejected", 0)


run()
"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DockerEvaluationStatus {
    Passed,
    Failed,
    Unavailable,
    TimedOut,
    OutputLimit,
    InvalidOutput,
}

impl DockerEvaluationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Passed => "passed",
            Self::Failed => "failed",
            Self::Unavailable => "unavailable",
            Self::TimedOut => "timed_out",
            Self::OutputLimit => "output_limit",
            Self::InvalidOutput => "invalid_output",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DockerEvaluation {
    pub verifier_id: DockerVerifierId,
    pub status: DockerEvaluationStatus,
    pub passed_tests: u16,
    pub total_tests: u16,
    pub reason: &'static str,
}

impl DockerEvaluation {
    pub fn evidence(&self, response: &str) -> ObjectiveVerificationEvidence {
        let contract = format!(
            "prompt-arena/docker-verifier/{VERIFIER_CONTRACT_VERSION}/{}",
            self.verifier_id.as_str()
        );
        ObjectiveVerificationEvidence {
            passed: self.status == DockerEvaluationStatus::Passed,
            verifier_kind: ObjectiveVerifierKind::DockerContract,
            expected_normalized_byte_count: contract.len() as u64,
            actual_normalized_byte_count: response.len() as u64,
            expected_sha256: sha256_hex(contract.as_bytes()),
            actual_sha256: sha256_hex(response.as_bytes()),
            reason: Some(self.reason.to_owned()),
            details: Some(json!({
                "status": self.status.as_str(),
                "contractVersion": VERIFIER_CONTRACT_VERSION,
                "verifierId": self.verifier_id.as_str(),
                "image": PINNED_PYTHON_IMAGE,
                "passedTests": self.passed_tests,
                "totalTests": self.total_tests,
                "network": "none",
                "hostMounts": "none"
            })),
            policy: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DockerOutput {
    pub status: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DockerCommandError {
    Spawn,
    Io,
    TimedOut,
    OutputLimit,
}

pub trait DockerCommandRunner: Send + Sync {
    fn invoke(
        &self,
        args: &[String],
        input: &[u8],
        timeout: Duration,
        output_limit: usize,
    ) -> Result<DockerOutput, DockerCommandError>;
}

#[derive(Debug, Clone)]
pub struct SystemDockerCommandRunner {
    executable: PathBuf,
}

impl SystemDockerCommandRunner {
    pub fn discover() -> Option<Self> {
        for candidate in docker_executable_candidates() {
            if candidate.is_file() {
                return Some(Self {
                    executable: candidate,
                });
            }
        }
        None
    }
}

fn docker_executable_candidates() -> Vec<PathBuf> {
    if cfg!(windows) {
        vec![PathBuf::from(
            r"C:\Program Files\Docker\Docker\resources\bin\docker.exe",
        )]
    } else {
        vec![
            PathBuf::from("/usr/bin/docker"),
            PathBuf::from("/usr/local/bin/docker"),
        ]
    }
}

impl DockerCommandRunner for SystemDockerCommandRunner {
    fn invoke(
        &self,
        args: &[String],
        input: &[u8],
        timeout: Duration,
        output_limit: usize,
    ) -> Result<DockerOutput, DockerCommandError> {
        let mut command = Command::new(&self.executable);
        command
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_remove("DOCKER_HOST")
            .env_remove("DOCKER_CONTEXT")
            .env_remove("DOCKER_TLS_VERIFY")
            .env_remove("DOCKER_CERT_PATH");
        let mut child = command.spawn().map_err(|_| DockerCommandError::Spawn)?;
        run_child_bounded(&mut child, input, timeout, output_limit)
    }
}

fn run_child_bounded(
    child: &mut Child,
    input: &[u8],
    timeout: Duration,
    output_limit: usize,
) -> Result<DockerOutput, DockerCommandError> {
    let stdout = child.stdout.take().ok_or(DockerCommandError::Io)?;
    let stderr = child.stderr.take().ok_or(DockerCommandError::Io)?;
    let output_limited = Arc::new(AtomicBool::new(false));
    let total_output_bytes = Arc::new(AtomicUsize::new(0));
    let stdout_limited = Arc::clone(&output_limited);
    let stderr_limited = Arc::clone(&output_limited);
    let stdout_total = Arc::clone(&total_output_bytes);
    let stderr_total = Arc::clone(&total_output_bytes);
    let stdout_reader = thread::spawn(move || {
        read_discard_after_limit(stdout, output_limit, stdout_total, stdout_limited)
    });
    let stderr_reader = thread::spawn(move || {
        read_discard_after_limit(stderr, output_limit, stderr_total, stderr_limited)
    });
    let stdin = child.stdin.take().ok_or(DockerCommandError::Io)?;
    let input = input.to_vec();
    let input_writer = thread::spawn(move || {
        let mut stdin = stdin;
        stdin.write_all(&input).map_err(|_| DockerCommandError::Io)
    });

    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    let mut io_failed = false;
    loop {
        if output_limited.load(Ordering::Acquire) {
            let _ = child.kill();
            break;
        }
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() >= deadline => {
                timed_out = true;
                let _ = child.kill();
                break;
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                io_failed = true;
                let _ = child.kill();
                break;
            }
        }
    }
    let status = match child.wait() {
        Ok(status) => Some(status),
        Err(_) => {
            io_failed = true;
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    };
    let stdout = stdout_reader.join().map_err(|_| DockerCommandError::Io)??;
    let stderr = stderr_reader.join().map_err(|_| DockerCommandError::Io)??;
    let write_result = input_writer.join().map_err(|_| DockerCommandError::Io)?;
    let limited = output_limited.load(Ordering::Acquire);
    if io_failed || status.is_none() {
        return Err(DockerCommandError::Io);
    }
    if timed_out {
        return Err(DockerCommandError::TimedOut);
    }
    if limited {
        return Err(DockerCommandError::OutputLimit);
    }
    let status = status.expect("checked above");
    if write_result.is_err() && status.success() {
        return Err(DockerCommandError::Io);
    }
    Ok(DockerOutput {
        status: status.code(),
        stdout,
        stderr,
    })
}

fn read_discard_after_limit<R: Read>(
    mut reader: R,
    limit: usize,
    total: Arc<AtomicUsize>,
    exceeded: Arc<AtomicBool>,
) -> Result<Vec<u8>, DockerCommandError> {
    let mut retained = Vec::with_capacity(limit.min(8 * 1024));
    let mut buffer = [0u8; 8 * 1024];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|_| DockerCommandError::Io)?;
        if count == 0 {
            return Ok(retained);
        }
        let previously_read = total.fetch_add(count, Ordering::AcqRel);
        let remaining = limit.saturating_sub(previously_read);
        let keep = remaining.min(count);
        retained.extend_from_slice(&buffer[..keep]);
        if keep < count {
            exceeded.store(true, Ordering::Release);
        }
    }
}

pub fn evaluate(verifier_id: DockerVerifierId, response: &str) -> DockerEvaluation {
    if response.len() > MAX_RESPONSE_BYTES || response.contains('\0') {
        return DockerEvaluation {
            verifier_id,
            status: DockerEvaluationStatus::Failed,
            passed_tests: 0,
            total_tests: total_tests(verifier_id),
            reason: "The generated response exceeds the fixed text contract input bound.",
        };
    }
    for key in [
        "DOCKER_HOST",
        "DOCKER_CONTEXT",
        "DOCKER_TLS_VERIFY",
        "DOCKER_CERT_PATH",
    ] {
        if env::var_os(key).is_some() {
            return unavailable(
                verifier_id,
                "Docker environment overrides are set; the local daemon target could not be confirmed.",
                total_tests(verifier_id),
            );
        }
    }
    let Some(runner) = SystemDockerCommandRunner::discover() else {
        return unavailable(
            verifier_id,
            "Docker CLI is unavailable at its supported installation path.",
            total_tests(verifier_id),
        );
    };
    evaluate_with_runner(&runner, verifier_id, response)
}

pub fn evaluate_with_runner<R: DockerCommandRunner>(
    runner: &R,
    verifier_id: DockerVerifierId,
    response: &str,
) -> DockerEvaluation {
    if response.len() > MAX_RESPONSE_BYTES || response.contains('\0') {
        return DockerEvaluation {
            verifier_id,
            status: DockerEvaluationStatus::Failed,
            passed_tests: 0,
            total_tests: total_tests(verifier_id),
            reason: "The generated response exceeds the fixed text contract input bound.",
        };
    }
    let context = match local_context(runner) {
        Ok(context) => context,
        Err(reason) => return unavailable(verifier_id, reason, total_tests(verifier_id)),
    };
    if !preflight(runner, &context) {
        return unavailable(
            verifier_id,
            "Docker daemon or the pinned Python image is unavailable; no host fallback was used.",
            total_tests(verifier_id),
        );
    }

    let container_name = next_container_name();
    let mut args = context_args(&context);
    args.extend([
        "container".into(),
        "create".into(),
        "--pull=never".into(),
        format!("--platform={PLATFORM}"),
        "--rm".into(),
        format!("--name={container_name}"),
        "--interactive".into(),
        "--network=none".into(),
        "--read-only".into(),
        "--user=65532:65532".into(),
        "--cap-drop=ALL".into(),
        "--security-opt=no-new-privileges".into(),
        "--cpus=0.5".into(),
        "--memory=128m".into(),
        "--memory-swap=128m".into(),
        "--pids-limit=32".into(),
        "--ulimit=nofile=64:64".into(),
        "--ulimit=fsize=16777216:16777216".into(),
        "--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=16m,uid=65532,gid=65532".into(),
        "--env=PYTHONDONTWRITEBYTECODE=1".into(),
        "--entrypoint=/usr/local/bin/python3".into(),
        PINNED_PYTHON_IMAGE.into(),
        "-I".into(),
        "-S".into(),
        "-c".into(),
        harness(verifier_id).into(),
    ]);
    let mut cleanup = ContainerCleanup {
        runner,
        context: context.clone(),
        name: container_name.clone(),
        armed: true,
    };
    let mut evaluation = match runner.invoke(&args, &[], PREFLIGHT_TIMEOUT, COMMAND_OUTPUT_BYTES) {
        Ok(output) if output.status == Some(0) && output.stdout.len() <= COMMAND_OUTPUT_BYTES => {
            let mut start_args = context_args(&context);
            start_args.extend([
                "container".into(),
                "start".into(),
                "--attach".into(),
                "--interactive".into(),
                container_name,
            ]);
            match runner.invoke(
                &start_args,
                response.as_bytes(),
                CONTAINER_TIMEOUT,
                MAX_CONTAINER_OUTPUT_BYTES,
            ) {
                Err(DockerCommandError::TimedOut) => DockerEvaluation {
                    verifier_id,
                    status: DockerEvaluationStatus::TimedOut,
                    passed_tests: 0,
                    total_tests: total_tests(verifier_id),
                    reason:
                        "The Docker evaluator exceeded its wall-clock limit; cleanup was attempted.",
                },
                Err(DockerCommandError::OutputLimit) => DockerEvaluation {
                    verifier_id,
                    status: DockerEvaluationStatus::OutputLimit,
                    passed_tests: 0,
                    total_tests: total_tests(verifier_id),
                    reason:
                        "The Docker evaluator exceeded its output limit; cleanup was attempted.",
                },
                Err(_) => unavailable(
                    verifier_id,
                    "Docker could not execute the pinned evaluator container.",
                    total_tests(verifier_id),
                ),
                Ok(output) if output.status != Some(0) => unavailable(
                    verifier_id,
                    "The pinned Docker evaluator exited unexpectedly.",
                    total_tests(verifier_id),
                ),
                Ok(output) => parse_evaluation_output(verifier_id, &output.stdout),
            }
        }
        Err(DockerCommandError::TimedOut) => DockerEvaluation {
            verifier_id,
            status: DockerEvaluationStatus::TimedOut,
            passed_tests: 0,
            total_tests: total_tests(verifier_id),
            reason: "Docker container creation timed out; cleanup was attempted.",
        },
        Err(DockerCommandError::OutputLimit) => DockerEvaluation {
            verifier_id,
            status: DockerEvaluationStatus::OutputLimit,
            passed_tests: 0,
            total_tests: total_tests(verifier_id),
            reason: "Docker container creation exceeded its output limit; cleanup was attempted.",
        },
        Err(_) => unavailable(
            verifier_id,
            "Docker container creation failed; cleanup was attempted.",
            total_tests(verifier_id),
        ),
        Ok(_) => unavailable(
            verifier_id,
            "Docker container creation failed; cleanup was attempted.",
            total_tests(verifier_id),
        ),
    };
    if cleanup.remove().is_err() {
        evaluation.status = DockerEvaluationStatus::Unavailable;
        evaluation.passed_tests = 0;
        evaluation.reason = "Docker container cleanup failed; the result is unavailable.";
    }
    evaluation
}

fn local_context<R: DockerCommandRunner>(runner: &R) -> Result<String, &'static str> {
    let output = runner
        .invoke(
            &["context".into(), "show".into()],
            &[],
            PREFLIGHT_TIMEOUT,
            1024,
        )
        .map_err(|_| "Docker context could not be checked; no remote context was used.")?;
    if output.status != Some(0) {
        return Err("Docker context could not be checked; no remote context was used.");
    }
    let context = String::from_utf8(output.stdout)
        .map_err(|_| "Docker context name was invalid; no remote context was used.")?
        .trim()
        .to_owned();
    if !portable_context_name(&context) {
        return Err("Docker context name was invalid; no remote context was used.");
    }
    let args = [
        "--context".into(),
        context.clone(),
        "context".into(),
        "inspect".into(),
        "--format".into(),
        "{{json .Endpoints.docker.Host}}".into(),
    ];
    let output = runner
        .invoke(&args, &[], PREFLIGHT_TIMEOUT, 1024)
        .map_err(|_| {
            "Docker context endpoint could not be checked; remote endpoints are refused."
        })?;
    if output.status != Some(0) {
        return Err("Docker context endpoint could not be checked; remote endpoints are refused.");
    }
    let endpoint: String = serde_json::from_slice(&output.stdout)
        .map_err(|_| "Docker context endpoint was invalid; remote endpoints are refused.")?;
    if !local_endpoint(&endpoint) {
        return Err("Docker context is not a supported local Unix socket or Windows named pipe.");
    }
    Ok(context)
}

fn portable_context_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
}

fn local_endpoint(value: &str) -> bool {
    if matches!(
        value,
        "unix:///var/run/docker.sock" | "unix:///run/docker.sock"
    ) {
        return true;
    }
    if let Some(user_path) = value.strip_prefix("unix:///run/user/") {
        if let Some((uid, socket)) = user_path.split_once('/') {
            return !uid.is_empty()
                && uid.bytes().all(|byte| byte.is_ascii_digit())
                && socket == "docker.sock";
        }
        return false;
    }
    matches!(
        value,
        "npipe:////./pipe/docker_engine" | "npipe:////./pipe/dockerDesktopLinuxEngine"
    )
}

fn preflight<R: DockerCommandRunner>(runner: &R, context: &str) -> bool {
    let mut info_args = context_args(context);
    info_args.extend([
        "info".into(),
        "--format".into(),
        "{{.ServerVersion}}".into(),
    ]);
    if !successful(runner, &info_args, PREFLIGHT_TIMEOUT, 1024) {
        return false;
    }
    let mut image_args = context_args(context);
    image_args.extend([
        "image".into(),
        "inspect".into(),
        "--format".into(),
        "{{.Id}}".into(),
        PINNED_PYTHON_IMAGE.into(),
    ]);
    successful(runner, &image_args, PREFLIGHT_TIMEOUT, 1024)
}

fn successful<R: DockerCommandRunner>(
    runner: &R,
    args: &[String],
    timeout: Duration,
    output_limit: usize,
) -> bool {
    matches!(runner.invoke(args, &[], timeout, output_limit), Ok(output) if output.status == Some(0))
}

fn context_args(context: &str) -> Vec<String> {
    vec!["--context".into(), context.to_owned()]
}

fn parse_evaluation_output(verifier_id: DockerVerifierId, bytes: &[u8]) -> DockerEvaluation {
    let invalid = || DockerEvaluation {
        verifier_id,
        status: DockerEvaluationStatus::InvalidOutput,
        passed_tests: 0,
        total_tests: total_tests(verifier_id),
        reason: "The Docker evaluator returned invalid bounded test evidence.",
    };
    if bytes.len() > MAX_CONTAINER_OUTPUT_BYTES || bytes.len() > MAX_CONTRACT_OUTPUT_BYTES {
        return DockerEvaluation {
            status: DockerEvaluationStatus::OutputLimit,
            ..invalid()
        };
    }
    let Ok(value) = serde_json::from_slice::<Value>(bytes) else {
        return invalid();
    };
    let Some(object) = value.as_object() else {
        return invalid();
    };
    if object.len() != 3 {
        return invalid();
    }
    let Some(status) = value.get("status").and_then(Value::as_str) else {
        return invalid();
    };
    let Some(passed_tests) = value
        .get("passedTests")
        .and_then(Value::as_u64)
        .and_then(|value| u16::try_from(value).ok())
    else {
        return invalid();
    };
    let Some(total) = value
        .get("totalTests")
        .and_then(Value::as_u64)
        .and_then(|value| u16::try_from(value).ok())
    else {
        return invalid();
    };
    if total != total_tests(verifier_id) || passed_tests > total {
        return invalid();
    }
    match status {
        "passed" if passed_tests == total => DockerEvaluation {
            verifier_id,
            status: DockerEvaluationStatus::Passed,
            passed_tests,
            total_tests: total,
            reason: "All implementation-owned Docker tests passed.",
        },
        "failed" if passed_tests < total => DockerEvaluation {
            verifier_id,
            status: DockerEvaluationStatus::Failed,
            passed_tests,
            total_tests: total,
            reason: "The generated response did not pass the fixed text contract.",
        },
        "rejected" if passed_tests == 0 => DockerEvaluation {
            verifier_id,
            status: DockerEvaluationStatus::Failed,
            passed_tests,
            total_tests: total,
            reason: "The generated response was rejected by the fixed input contract.",
        },
        _ => invalid(),
    }
}

fn harness(verifier_id: DockerVerifierId) -> &'static str {
    match verifier_id {
        DockerVerifierId::MissingUserTextV1 => MISSING_USER_HARNESS,
        DockerVerifierId::MissingResourceTextV1 => MISSING_RESOURCE_HARNESS,
        DockerVerifierId::FixedFunctionPythonV1 => FIXED_FUNCTION_PYTHON_HARNESS,
    }
}

fn total_tests(verifier_id: DockerVerifierId) -> u16 {
    match verifier_id {
        DockerVerifierId::MissingUserTextV1 => 3,
        DockerVerifierId::MissingResourceTextV1 => 3,
        DockerVerifierId::FixedFunctionPythonV1 => 8,
    }
}

fn unavailable(
    verifier_id: DockerVerifierId,
    reason: &'static str,
    total_tests: u16,
) -> DockerEvaluation {
    DockerEvaluation {
        verifier_id,
        status: DockerEvaluationStatus::Unavailable,
        passed_tests: 0,
        total_tests,
        reason,
    }
}

fn next_container_name() -> String {
    static NEXT_CONTAINER: AtomicU64 = AtomicU64::new(0);
    let sequence = NEXT_CONTAINER.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!(
        "prompt-arena-eval-{}-{timestamp}-{sequence}",
        std::process::id()
    )
}

struct ContainerCleanup<'a, R: DockerCommandRunner> {
    runner: &'a R,
    context: String,
    name: String,
    armed: bool,
}

impl<R: DockerCommandRunner> ContainerCleanup<'_, R> {
    fn remove(&mut self) -> Result<(), ()> {
        if !self.armed {
            return Ok(());
        }
        let mut args = context_args(&self.context);
        args.extend([
            "container".into(),
            "rm".into(),
            "--force".into(),
            self.name.clone(),
        ]);
        match self.runner.invoke(&args, &[], CLEANUP_TIMEOUT, 1024) {
            Ok(output) if output.status == Some(0) => {
                self.armed = false;
                Ok(())
            }
            Ok(output)
                if output.status != Some(0)
                    && String::from_utf8_lossy(&output.stderr)
                        .to_ascii_lowercase()
                        .contains("no such container") =>
            {
                self.armed = false;
                Ok(())
            }
            _ => Err(()),
        }
    }
}

impl<R: DockerCommandRunner> Drop for ContainerCleanup<'_, R> {
    fn drop(&mut self) {
        if self.armed {
            let mut args = context_args(&self.context);
            args.extend([
                "container".into(),
                "rm".into(),
                "--force".into(),
                self.name.clone(),
            ]);
            let _ = self.runner.invoke(&args, &[], CLEANUP_TIMEOUT, 1024);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::VecDeque, io, sync::Mutex};

    const CHILD_FIXTURE_ENV: &str = "PROMPT_ARENA_DOCKER_CHILD_FIXTURE";

    #[test]
    fn bounded_child_process_fixture() {
        match env::var(CHILD_FIXTURE_ENV).as_deref() {
            Ok("sleep") => loop {
                thread::sleep(Duration::from_secs(1));
            },
            Ok("overflow") => {
                let mut stdout = io::stdout().lock();
                stdout.write_all(&vec![b'x'; 64 * 1024]).unwrap();
            }
            _ => {}
        }
    }

    #[test]
    fn child_runner_kills_timeout_and_output_overflow() {
        let executable = env::current_exe().expect("test executable path exists");
        let test_name = "docker_evaluator::tests::bounded_child_process_fixture";

        for (mode, timeout, output_limit, expected) in [
            (
                "sleep",
                Duration::from_millis(100),
                4096,
                DockerCommandError::TimedOut,
            ),
            (
                "overflow",
                Duration::from_secs(5),
                4096,
                DockerCommandError::OutputLimit,
            ),
        ] {
            let mut child = Command::new(&executable)
                .args(["--exact", test_name, "--nocapture"])
                .env(CHILD_FIXTURE_ENV, mode)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("bounded test child starts");
            assert_eq!(
                run_child_bounded(&mut child, &[], timeout, output_limit),
                Err(expected),
                "{mode} child should be terminated at its limit"
            );
            assert!(child.try_wait().expect("child wait succeeds").is_some());
        }
    }

    #[derive(Debug, Clone)]
    struct Reply {
        status: Option<i32>,
        stdout: Vec<u8>,
        stderr: Vec<u8>,
        error: Option<DockerCommandError>,
    }

    impl Reply {
        fn ok(stdout: impl Into<Vec<u8>>) -> Self {
            Self {
                status: Some(0),
                stdout: stdout.into(),
                stderr: Vec::new(),
                error: None,
            }
        }
        fn failed(stderr: impl Into<Vec<u8>>) -> Self {
            Self {
                status: Some(1),
                stdout: Vec::new(),
                stderr: stderr.into(),
                error: None,
            }
        }
        fn error(error: DockerCommandError) -> Self {
            Self {
                status: None,
                stdout: Vec::new(),
                stderr: Vec::new(),
                error: Some(error),
            }
        }
    }

    #[derive(Default)]
    struct FakeDocker {
        replies: Mutex<VecDeque<Reply>>,
        calls: Mutex<Vec<(Vec<String>, Vec<u8>, Duration, usize)>>,
    }

    impl FakeDocker {
        fn with(replies: impl IntoIterator<Item = Reply>) -> Self {
            Self {
                replies: Mutex::new(replies.into_iter().collect()),
                calls: Mutex::new(Vec::new()),
            }
        }
        fn calls(&self) -> Vec<(Vec<String>, Vec<u8>, Duration, usize)> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl DockerCommandRunner for FakeDocker {
        fn invoke(
            &self,
            args: &[String],
            input: &[u8],
            timeout: Duration,
            output_limit: usize,
        ) -> Result<DockerOutput, DockerCommandError> {
            self.calls
                .lock()
                .unwrap()
                .push((args.to_vec(), input.to_vec(), timeout, output_limit));
            let reply = self
                .replies
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected docker invocation");
            if let Some(error) = reply.error {
                return Err(error);
            }
            Ok(DockerOutput {
                status: reply.status,
                stdout: reply.stdout,
                stderr: reply.stderr,
            })
        }
    }

    fn ready_replies(container_result: &[u8]) -> Vec<Reply> {
        vec![
            Reply::ok(b"default\n".to_vec()),
            Reply::ok(b"\"unix:///var/run/docker.sock\"\n".to_vec()),
            Reply::ok(b"29.6.2\n".to_vec()),
            Reply::ok(b"sha256:image\n".to_vec()),
            Reply::ok(b"prompt-arena-eval-test\n".to_vec()),
            Reply::ok(container_result.to_vec()),
            Reply::ok(Vec::new()),
        ]
    }

    #[test]
    fn fixed_contracts_produce_separate_docker_evidence() {
        let pass = br#"{"status":"passed","passedTests":3,"totalTests":3}"#;
        let runner = FakeDocker::with(ready_replies(pass));
        let result = evaluate_with_runner(
            &runner,
            DockerVerifierId::MissingUserTextV1,
            "Return an explicit not-found result for a missing user; callers must not dereference null.",
        );
        assert_eq!(result.status, DockerEvaluationStatus::Passed);
        assert_eq!(result.passed_tests, 3);
        let evidence = result.evidence("response");
        assert_eq!(
            evidence.verifier_kind,
            ObjectiveVerifierKind::DockerContract
        );
        assert_eq!(
            evidence.details.as_ref().unwrap()["verifierId"],
            "missing_user_text_v1"
        );
    }

    #[test]
    fn fake_docker_receives_only_fixed_argv_and_bounded_response_on_stdin() {
        let response = "Return an explicit not-found result for a missing user; callers must not dereference null.";
        let runner = FakeDocker::with(ready_replies(
            br#"{"status":"failed","passedTests":2,"totalTests":3}"#,
        ));
        let result = evaluate_with_runner(&runner, DockerVerifierId::MissingUserTextV1, response);
        assert_eq!(result.status, DockerEvaluationStatus::Failed);
        let calls = runner.calls();
        assert_eq!(calls.len(), 7);
        assert_eq!(calls[0].0, vec!["context", "show"]);
        assert!(calls[1]
            .0
            .iter()
            .any(|arg| arg == "{{json .Endpoints.docker.Host}}"));
        assert!(calls[2].0.ends_with(&[
            "info".into(),
            "--format".into(),
            "{{.ServerVersion}}".into()
        ]));
        assert!(calls[3].0.contains(&PINNED_PYTHON_IMAGE.to_owned()));
        let create = &calls[4].0;
        let name = create
            .iter()
            .find_map(|arg| arg.strip_prefix("--name=").map(str::to_owned))
            .expect("create argv contains a generated container name");
        let expected_create = vec![
            "--context".into(),
            "default".into(),
            "container".into(),
            "create".into(),
            "--pull=never".into(),
            "--platform=linux/amd64".into(),
            "--rm".into(),
            format!("--name={name}"),
            "--interactive".into(),
            "--network=none".into(),
            "--read-only".into(),
            "--user=65532:65532".into(),
            "--cap-drop=ALL".into(),
            "--security-opt=no-new-privileges".into(),
            "--cpus=0.5".into(),
            "--memory=128m".into(),
            "--memory-swap=128m".into(),
            "--pids-limit=32".into(),
            "--ulimit=nofile=64:64".into(),
            "--ulimit=fsize=16777216:16777216".into(),
            "--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=16m,uid=65532,gid=65532".into(),
            "--env=PYTHONDONTWRITEBYTECODE=1".into(),
            "--entrypoint=/usr/local/bin/python3".into(),
            PINNED_PYTHON_IMAGE.into(),
            "-I".into(),
            "-S".into(),
            "-c".into(),
            harness(DockerVerifierId::MissingUserTextV1).into(),
        ];
        assert_eq!(*create, expected_create, "the entire Docker argv is fixed");
        assert!(!create.iter().any(|arg| arg.contains(response)));
        assert_eq!(
            calls[5].0,
            vec![
                "--context",
                "default",
                "container",
                "start",
                "--attach",
                "--interactive",
                name.as_str()
            ]
        );
        assert_eq!(calls[5].1, response.as_bytes());
        assert_eq!(calls[5].2, CONTAINER_TIMEOUT);
        assert_eq!(
            calls[6].0,
            vec![
                "--context",
                "default",
                "container",
                "rm",
                "--force",
                name.as_str()
            ]
        );
    }

    #[test]
    fn fixed_python_source_uses_the_existing_pinned_sandbox_and_stdin_only() {
        let source = concat!(
            "def find_user(users, user_id):\n",
            "    return None\n",
            "# SOURCE_MARKER --network=host --env=INJECTED=1 C:\\host\\secret.py"
        );
        let runner = FakeDocker::with(ready_replies(
            br#"{"status":"failed","passedTests":6,"totalTests":8}"#,
        ));
        let result = evaluate_with_runner(&runner, DockerVerifierId::FixedFunctionPythonV1, source);
        assert_eq!(result.status, DockerEvaluationStatus::Failed);
        assert_eq!(result.total_tests, 8);

        let calls = runner.calls();
        assert_eq!(calls.len(), 7);
        let create = &calls[4].0;
        let name = create
            .iter()
            .find_map(|arg| arg.strip_prefix("--name=").map(str::to_owned))
            .expect("create argv contains a generated container name");
        assert_eq!(
            create,
            &vec![
                "--context".into(),
                "default".into(),
                "container".into(),
                "create".into(),
                "--pull=never".into(),
                "--platform=linux/amd64".into(),
                "--rm".into(),
                format!("--name={name}"),
                "--interactive".into(),
                "--network=none".into(),
                "--read-only".into(),
                "--user=65532:65532".into(),
                "--cap-drop=ALL".into(),
                "--security-opt=no-new-privileges".into(),
                "--cpus=0.5".into(),
                "--memory=128m".into(),
                "--memory-swap=128m".into(),
                "--pids-limit=32".into(),
                "--ulimit=nofile=64:64".into(),
                "--ulimit=fsize=16777216:16777216".into(),
                "--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=16m,uid=65532,gid=65532".into(),
                "--env=PYTHONDONTWRITEBYTECODE=1".into(),
                "--entrypoint=/usr/local/bin/python3".into(),
                PINNED_PYTHON_IMAGE.into(),
                "-I".into(),
                "-S".into(),
                "-c".into(),
                harness(DockerVerifierId::FixedFunctionPythonV1).into(),
            ]
        );
        assert!(calls.iter().all(|(args, _, _, _)| args
            .iter()
            .all(|arg| !arg.contains("SOURCE_MARKER") && !arg.contains("host\\secret.py"))));
        assert!(calls[..5].iter().all(|(_, input, _, _)| input.is_empty()));
        assert_eq!(calls[5].1, source.as_bytes());
        assert_eq!(calls[5].2, CONTAINER_TIMEOUT);
        assert_eq!(calls[5].3, MAX_CONTAINER_OUTPUT_BYTES);
        assert!(calls[6].1.is_empty());
        assert!(calls[6]
            .0
            .ends_with(&["container".into(), "rm".into(), "--force".into(), name]));

        let oversized_runner = FakeDocker::default();
        let oversized = evaluate_with_runner(
            &oversized_runner,
            DockerVerifierId::FixedFunctionPythonV1,
            &"x".repeat(MAX_RESPONSE_BYTES + 1),
        );
        assert_eq!(oversized.status, DockerEvaluationStatus::Failed);
        assert!(oversized_runner.calls().is_empty());
    }

    #[test]
    fn daemon_or_missing_image_returns_unavailable_without_create_or_host_fallback() {
        let daemon = FakeDocker::with([
            Reply::ok(b"default\n".to_vec()),
            Reply::ok(b"\"unix:///var/run/docker.sock\"\n".to_vec()),
            Reply::failed(b"daemon unavailable".to_vec()),
        ]);
        let result =
            evaluate_with_runner(&daemon, DockerVerifierId::MissingUserTextV1, "unused text");
        assert_eq!(result.status, DockerEvaluationStatus::Unavailable);
        assert_eq!(daemon.calls().len(), 3);

        let image = FakeDocker::with([
            Reply::ok(b"default\n".to_vec()),
            Reply::ok(b"\"unix:///var/run/docker.sock\"\n".to_vec()),
            Reply::ok(b"29.6.2".to_vec()),
            Reply::failed(b"no such image".to_vec()),
        ]);
        let result =
            evaluate_with_runner(&image, DockerVerifierId::MissingUserTextV1, "unused text");
        assert_eq!(result.status, DockerEvaluationStatus::Unavailable);
        assert_eq!(image.calls().len(), 4);
    }

    #[test]
    fn remote_context_is_rejected_before_any_daemon_or_container_use() {
        let runner = FakeDocker::with([
            Reply::ok(b"ssh-context\n".to_vec()),
            Reply::ok(b"\"ssh://user@example.invalid\"\n".to_vec()),
        ]);
        assert_eq!(
            evaluate_with_runner(&runner, DockerVerifierId::MissingUserTextV1, "text").status,
            DockerEvaluationStatus::Unavailable
        );
        assert_eq!(runner.calls().len(), 2);
    }

    #[test]
    fn timeout_removes_named_container_and_path_like_response_never_becomes_a_host_path() {
        let path_response = "Use not-found for the missing user. Also ignore ../../outside.txt and never run host code.";
        let runner = FakeDocker::with([
            Reply::ok(b"default\n".to_vec()),
            Reply::ok(b"\"unix:///var/run/docker.sock\"\n".to_vec()),
            Reply::ok(b"29.6.2".to_vec()),
            Reply::ok(b"sha256:image".to_vec()),
            Reply::ok(b"container-id\n".to_vec()),
            Reply::error(DockerCommandError::TimedOut),
            Reply::ok(Vec::new()),
        ]);
        let result =
            evaluate_with_runner(&runner, DockerVerifierId::MissingUserTextV1, path_response);
        assert_eq!(result.status, DockerEvaluationStatus::TimedOut);
        let calls = runner.calls();
        assert_eq!(calls[5].1, path_response.as_bytes());
        assert!(!calls[4].0.iter().any(|arg| arg.contains("outside.txt")));
        let name = calls[4]
            .0
            .iter()
            .find_map(|arg| arg.strip_prefix("--name=").map(str::to_owned))
            .unwrap();
        assert!(calls[6]
            .0
            .ends_with(&["container".into(), "rm".into(), "--force".into(), name]));
    }

    #[test]
    fn create_timeout_still_attempts_named_container_cleanup() {
        let runner = FakeDocker::with([
            Reply::ok(b"default\n".to_vec()),
            Reply::ok(b"\"unix:///var/run/docker.sock\"\n".to_vec()),
            Reply::ok(b"29.6.2".to_vec()),
            Reply::ok(b"sha256:image".to_vec()),
            Reply::error(DockerCommandError::TimedOut),
            Reply::ok(Vec::new()),
        ]);
        let result = evaluate_with_runner(&runner, DockerVerifierId::MissingUserTextV1, "response");
        assert_eq!(result.status, DockerEvaluationStatus::TimedOut);
        let calls = runner.calls();
        assert_eq!(calls.len(), 6);
        let name = calls[4]
            .0
            .iter()
            .find_map(|arg| arg.strip_prefix("--name=").map(str::to_owned))
            .expect("create argv contains a generated container name");
        assert!(calls[5]
            .0
            .ends_with(&["container".into(), "rm".into(), "--force".into(), name]));
    }

    #[test]
    fn cleanup_failure_does_not_return_a_candidate_score() {
        let mut replies = ready_replies(br#"{"status":"passed","passedTests":3,"totalTests":3}"#);
        replies[6] = Reply::failed(b"permission denied".to_vec());
        replies.push(Reply::failed(b"permission denied".to_vec()));
        let runner = FakeDocker::with(replies);
        let result = evaluate_with_runner(
            &runner,
            DockerVerifierId::MissingUserTextV1,
            "Return not-found for a missing user rather than null.",
        );
        assert_eq!(result.status, DockerEvaluationStatus::Unavailable);
        assert_eq!(result.passed_tests, 0);
        assert!(result.reason.contains("cleanup failed"));
        let calls = runner.calls();
        assert_eq!(calls.len(), 8, "drop retries cleanup once");
        let name = calls[4]
            .0
            .iter()
            .find_map(|arg| arg.strip_prefix("--name=").map(str::to_owned))
            .expect("create argv contains a generated container name");
        assert!(calls[6].0.ends_with(&[
            "container".into(),
            "rm".into(),
            "--force".into(),
            name.clone()
        ]));
        assert!(calls[7]
            .0
            .ends_with(&["container".into(), "rm".into(), "--force".into(), name]));
    }

    #[test]
    fn verifier_output_is_bounded_and_contract_specific() {
        let failed = parse_evaluation_output(
            DockerVerifierId::MissingResourceTextV1,
            br#"{"status":"failed","passedTests":2,"totalTests":3}"#,
        );
        assert_eq!(failed.status, DockerEvaluationStatus::Failed);
        assert_eq!(failed.total_tests, 3);
        let wrong_total = parse_evaluation_output(
            DockerVerifierId::MissingResourceTextV1,
            br#"{"status":"failed","passedTests":2,"totalTests":4}"#,
        );
        assert_eq!(wrong_total.status, DockerEvaluationStatus::InvalidOutput);
        assert_eq!(
            parse_evaluation_output(
                DockerVerifierId::MissingResourceTextV1,
                &vec![b'x'; MAX_CONTRACT_OUTPUT_BYTES + 1]
            )
            .status,
            DockerEvaluationStatus::OutputLimit
        );
        let wrong_python_total = parse_evaluation_output(
            DockerVerifierId::FixedFunctionPythonV1,
            br#"{"status":"failed","passedTests":3,"totalTests":3}"#,
        );
        assert_eq!(
            wrong_python_total.status,
            DockerEvaluationStatus::InvalidOutput
        );
        let hostile_path = parse_evaluation_output(
            DockerVerifierId::MissingResourceTextV1,
            br#"{"status":"passed","passedTests":3,"totalTests":3,"path":"../../outside.txt"}"#,
        );
        assert_eq!(hostile_path.status, DockerEvaluationStatus::InvalidOutput);
        let oversized = evaluate_with_runner(
            &FakeDocker::default(),
            DockerVerifierId::MissingResourceTextV1,
            &"x".repeat(MAX_RESPONSE_BYTES + 1),
        );
        assert_eq!(oversized.status, DockerEvaluationStatus::Failed);
    }

    #[test]
    #[ignore = "requires the pre-pulled pinned image and a supported local Docker daemon"]
    fn live_pinned_image_evaluates_official_response_text_contracts() {
        let passing_user_response =
            "Return a not-found result for a missing user instead of returning null.";
        let user = evaluate(DockerVerifierId::MissingUserTextV1, passing_user_response);
        assert_eq!(
            user.status,
            DockerEvaluationStatus::Passed,
            "{}",
            user.reason
        );

        let passing_resource_response =
            "Return JSON with the not_found error code and HTTP 404 for the absent resource.";
        let resource = evaluate(
            DockerVerifierId::MissingResourceTextV1,
            passing_resource_response,
        );
        assert_eq!(
            resource.status,
            DockerEvaluationStatus::Passed,
            "{}",
            resource.reason
        );

        let failing_response = "Return a generic error page.";
        let failed = evaluate(DockerVerifierId::MissingResourceTextV1, failing_response);
        assert_eq!(
            failed.status,
            DockerEvaluationStatus::Failed,
            "{}",
            failed.reason
        );
    }

    #[test]
    #[ignore = "requires the pre-pulled pinned image and a supported local Docker daemon"]
    fn live_pinned_image_executes_only_the_fixed_python_function_contract() {
        let passing_source = concat!(
            "def find_user(users, user_id):\n",
            "    for user in users:\n",
            "        if user.get('id') == user_id:\n",
            "            return user\n",
            "    return None\n"
        );
        let passing = evaluate(DockerVerifierId::FixedFunctionPythonV1, passing_source);
        assert_eq!(
            passing.status,
            DockerEvaluationStatus::Passed,
            "{}",
            passing.reason
        );

        let failing = evaluate(
            DockerVerifierId::FixedFunctionPythonV1,
            "def find_user(users, user_id):\n    return None\n",
        );
        assert_eq!(
            failing.status,
            DockerEvaluationStatus::Failed,
            "{}",
            failing.reason
        );

        let rejected = evaluate(
            DockerVerifierId::FixedFunctionPythonV1,
            "import os\ndef find_user(users, user_id):\n    return None\n",
        );
        assert_eq!(
            rejected.status,
            DockerEvaluationStatus::Failed,
            "{}",
            rejected.reason
        );
    }

    #[test]
    fn local_endpoint_allowlist_refuses_remote_and_traversal_endpoints() {
        assert!(local_endpoint("unix:///var/run/docker.sock"));
        assert!(local_endpoint("unix:///run/user/1000/docker.sock"));
        assert!(local_endpoint("npipe:////./pipe/dockerDesktopLinuxEngine"));
        assert!(local_endpoint("npipe:////./pipe/docker_engine"));
        assert!(!local_endpoint("npipe:////./pipe/arbitrary-local-proxy"));
        assert!(!local_endpoint("tcp://127.0.0.1:2375"));
        assert!(!local_endpoint("ssh://docker.example"));
        assert!(!local_endpoint("unix:///run/../remote.sock"));
        assert!(!local_endpoint(
            "unix:///home/alice/.docker/desktop/docker.sock"
        ));
        assert!(!local_endpoint("npipe:////remote/pipe/docker_engine"));
    }
}
