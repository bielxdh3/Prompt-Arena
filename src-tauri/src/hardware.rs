use std::{
    num::NonZeroUsize,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

#[cfg(target_os = "linux")]
use std::{fs::File, io::Read};

#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
};

use serde::{Deserialize, Serialize};

#[cfg(target_os = "linux")]
const MAX_LINUX_MEMINFO_BYTES: usize = 64 * 1024;

#[cfg(target_os = "linux")]
const MAX_LINUX_CPUSTAT_BYTES: usize = 64 * 1024;

const HOST_TELEMETRY_SAMPLE_INTERVAL: Duration = Duration::from_millis(1_000);
const MAX_HOST_TELEMETRY_SAMPLES: usize = 8_192;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HardwarePlatform {
    Windows,
    Linux,
    Other,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HardwareMetricStatus {
    Available,
    Unavailable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HardwareSource {
    Stdlib,
    LinuxProcfs,
    WindowsKernel32,
    WindowsDxgi,
    NotDetected,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HardwareConfidence {
    High,
    Medium,
    Low,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareMetric<T> {
    pub value: Option<T>,
    pub status: HardwareMetricStatus,
    pub source: HardwareSource,
    pub confidence: HardwareConfidence,
}

impl<T> HardwareMetric<T> {
    fn available(value: T, source: HardwareSource, confidence: HardwareConfidence) -> Self {
        Self {
            value: Some(value),
            status: HardwareMetricStatus::Available,
            source,
            confidence,
        }
    }

    fn unavailable(source: HardwareSource) -> Self {
        Self {
            value: None,
            status: HardwareMetricStatus::Unavailable,
            source,
            confidence: HardwareConfidence::Unavailable,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSnapshot {
    pub platform: HardwarePlatform,
    pub logical_cpu_count: HardwareMetric<u32>,
    pub memory_bytes: HardwareMetric<u64>,
    pub gpu_name: HardwareMetric<String>,
    pub vram_bytes: HardwareMetric<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TelemetryScope {
    Host,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HostTelemetrySamplingMethod {
    OsCounter,
    OsSample,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HostTelemetryMetric<T> {
    pub value: Option<T>,
    pub status: HardwareMetricStatus,
    pub source: String,
    pub sampling_method: HostTelemetrySamplingMethod,
    pub method: String,
    pub sampling_interval_ms: Option<f64>,
    pub sample_count: u32,
    pub interval_count: u32,
}

/// [monotonic elapsed milliseconds, cumulative CPU total ticks, cumulative CPU idle ticks,
/// host physical RAM used bytes]. CPU counters are decimal strings so JSON consumers do not
/// lose integer precision. A missing OS read is represented by null tuple elements.
pub type HostTelemetrySample = (u64, Option<String>, Option<String>, Option<u64>);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HostHardwareTelemetry {
    pub scope: TelemetryScope,
    pub platform: HardwarePlatform,
    pub window_duration_ms: f64,
    pub target_sampling_interval_ms: u64,
    pub raw_samples: Vec<HostTelemetrySample>,
    pub samples_truncated: bool,
    /// Counter-delta-weighted host-wide CPU busy percentage; this is not process attribution.
    pub cpu_utilization_percent: HostTelemetryMetric<f64>,
    /// Arithmetic mean of sampled host physical memory in use (total minus available).
    pub ram_average_bytes: HostTelemetryMetric<u64>,
    /// Highest sampled host physical memory in use (total minus available).
    pub ram_peak_bytes: HostTelemetryMetric<u64>,
}

/// Samples host-wide OS counters only while a local generation request is active.
/// Values are not attributed to the model process.
pub struct HostTelemetrySampler {
    started: Instant,
    stop_sender: Option<mpsc::Sender<()>>,
    sampler: Option<thread::JoinHandle<HostHardwareTelemetry>>,
}

impl HostTelemetrySampler {
    pub fn start() -> Self {
        let started = Instant::now();
        #[cfg(any(target_os = "linux", target_os = "windows"))]
        {
            let (stop_sender, stop_receiver) = mpsc::channel();
            let worker_started = started;
            let sampler = thread::Builder::new()
                .name("prompt-arena-host-telemetry".to_owned())
                .spawn(move || sample_host_window(stop_receiver, worker_started))
                .ok();
            if sampler.is_some() {
                return Self {
                    started,
                    stop_sender: Some(stop_sender),
                    sampler,
                };
            }
        }
        Self {
            started,
            stop_sender: None,
            sampler: None,
        }
    }

    pub fn finish(mut self) -> HostHardwareTelemetry {
        self.stop_sampler()
            .unwrap_or_else(|| unavailable_host_window(self.started.elapsed()))
    }

    fn stop_sampler(&mut self) -> Option<HostHardwareTelemetry> {
        if let Some(stop_sender) = self.stop_sender.take() {
            let _ = stop_sender.send(());
        }
        self.sampler.take().and_then(|sampler| sampler.join().ok())
    }
}

impl Drop for HostTelemetrySampler {
    fn drop(&mut self) {
        let _ = self.stop_sampler();
    }
}

pub fn read_hardware_snapshot() -> HardwareSnapshot {
    let (gpu_name, vram_bytes) = gpu_metrics();
    HardwareSnapshot {
        platform: current_platform(),
        logical_cpu_count: logical_cpu_metric(),
        memory_bytes: memory_metric(),
        gpu_name,
        vram_bytes,
    }
}

fn current_platform() -> HardwarePlatform {
    #[cfg(target_os = "windows")]
    {
        return HardwarePlatform::Windows;
    }
    #[cfg(target_os = "linux")]
    {
        return HardwarePlatform::Linux;
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        HardwarePlatform::Other
    }
}

fn logical_cpu_metric() -> HardwareMetric<u32> {
    match std::thread::available_parallelism()
        .ok()
        .map(NonZeroUsize::get)
        .and_then(|count| u32::try_from(count).ok())
    {
        Some(count) if count > 0 => {
            HardwareMetric::available(count, HardwareSource::Stdlib, HardwareConfidence::High)
        }
        _ => HardwareMetric::unavailable(HardwareSource::Stdlib),
    }
}

fn memory_metric() -> HardwareMetric<u64> {
    #[cfg(target_os = "linux")]
    {
        return parse_linux_memory_metric();
    }
    #[cfg(target_os = "windows")]
    {
        return windows_memory_metric();
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        HardwareMetric::unavailable(HardwareSource::NotDetected)
    }
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CpuCounters {
    total: u64,
    idle: u64,
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
#[derive(Debug, Clone, Copy, Default)]
struct HostResourceSample {
    cpu: Option<CpuCounters>,
    ram_used_bytes: Option<u64>,
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
#[derive(Default)]
struct HostTelemetryCollector {
    previous_cpu: Option<(CpuCounters, Instant)>,
    cpu_busy_counter_delta_total: u128,
    cpu_total_counter_delta_total: u128,
    cpu_sample_count: u32,
    cpu_interval_count: u32,
    cpu_interval_ms_total: f64,
    previous_ram_at: Option<Instant>,
    ram_total_bytes: u128,
    ram_peak_bytes: u64,
    ram_sample_count: u32,
    ram_interval_count: u32,
    ram_interval_ms_total: f64,
    raw_samples: Vec<HostTelemetrySample>,
    samples_truncated: bool,
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
impl HostTelemetryCollector {
    fn record(&mut self, sample: HostResourceSample, sampled_at: Instant, window_started: Instant) {
        let (total_cpu_counter, idle_cpu_counter) = sample
            .cpu
            .map(|counters| {
                (
                    Some(counters.total.to_string()),
                    Some(counters.idle.to_string()),
                )
            })
            .unwrap_or((None, None));
        if self.raw_samples.len() < MAX_HOST_TELEMETRY_SAMPLES {
            self.raw_samples.push((
                sampled_at
                    .saturating_duration_since(window_started)
                    .as_millis()
                    .min(u128::from(u64::MAX)) as u64,
                total_cpu_counter,
                idle_cpu_counter,
                sample.ram_used_bytes,
            ));
        } else {
            self.samples_truncated = true;
        }

        if let Some(current) = sample.cpu {
            self.cpu_sample_count = self.cpu_sample_count.saturating_add(1);
            if let Some((previous, previous_at)) = self.previous_cpu {
                if let Some((total_delta, busy_delta)) = cpu_counter_deltas(previous, current) {
                    self.cpu_busy_counter_delta_total = self
                        .cpu_busy_counter_delta_total
                        .saturating_add(u128::from(busy_delta));
                    self.cpu_total_counter_delta_total = self
                        .cpu_total_counter_delta_total
                        .saturating_add(u128::from(total_delta));
                    self.cpu_interval_count = self.cpu_interval_count.saturating_add(1);
                    self.cpu_interval_ms_total += sampled_at
                        .saturating_duration_since(previous_at)
                        .as_secs_f64()
                        * 1_000.0;
                }
            }
            self.previous_cpu = Some((current, sampled_at));
        } else {
            self.previous_cpu = None;
        }

        if let Some(bytes) = sample.ram_used_bytes {
            if let Some(previous_at) = self.previous_ram_at {
                self.ram_interval_ms_total += sampled_at
                    .saturating_duration_since(previous_at)
                    .as_secs_f64()
                    * 1_000.0;
                self.ram_interval_count = self.ram_interval_count.saturating_add(1);
            }
            self.previous_ram_at = Some(sampled_at);
            self.ram_total_bytes = self.ram_total_bytes.saturating_add(u128::from(bytes));
            self.ram_peak_bytes = self.ram_peak_bytes.max(bytes);
            self.ram_sample_count = self.ram_sample_count.saturating_add(1);
        }
    }

    fn finish(self, started: Instant) -> HostHardwareTelemetry {
        let cpu_average = (self.cpu_interval_count > 0 && self.cpu_total_counter_delta_total > 0)
            .then(|| {
                self.cpu_busy_counter_delta_total as f64 / self.cpu_total_counter_delta_total as f64
                    * 100.0
            });
        let ram_average = (self.ram_sample_count > 0).then(|| {
            (self.ram_total_bytes / u128::from(self.ram_sample_count)).min(u128::from(u64::MAX))
                as u64
        });
        let ram_peak = (self.ram_sample_count > 0).then_some(self.ram_peak_bytes);
        HostHardwareTelemetry {
            scope: TelemetryScope::Host,
            platform: current_platform(),
            window_duration_ms: started.elapsed().as_secs_f64() * 1_000.0,
            target_sampling_interval_ms: HOST_TELEMETRY_SAMPLE_INTERVAL.as_millis() as u64,
            raw_samples: self.raw_samples,
            samples_truncated: self.samples_truncated,
            cpu_utilization_percent: host_telemetry_metric(
                cpu_average,
                HostTelemetrySamplingMethod::OsCounter,
                self.cpu_sample_count,
                self.cpu_interval_count,
                mean_interval(self.cpu_interval_ms_total, self.cpu_interval_count),
                host_cpu_source(),
                "counter_delta_weighted_host_busy_percent",
            ),
            ram_average_bytes: host_telemetry_metric(
                ram_average,
                HostTelemetrySamplingMethod::OsSample,
                self.ram_sample_count,
                self.ram_interval_count,
                mean_interval(self.ram_interval_ms_total, self.ram_interval_count),
                host_ram_source(),
                "sampled_host_physical_used_mean",
            ),
            ram_peak_bytes: host_telemetry_metric(
                ram_peak,
                HostTelemetrySamplingMethod::OsSample,
                self.ram_sample_count,
                self.ram_interval_count,
                mean_interval(self.ram_interval_ms_total, self.ram_interval_count),
                host_ram_source(),
                "sampled_host_physical_used_peak",
            ),
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn mean_interval(total_ms: f64, interval_count: u32) -> Option<f64> {
    (interval_count > 0 && total_ms.is_finite()).then(|| total_ms / f64::from(interval_count))
}

fn host_telemetry_metric<T>(
    value: Option<T>,
    sampling_method: HostTelemetrySamplingMethod,
    sample_count: u32,
    interval_count: u32,
    sampling_interval_ms: Option<f64>,
    source: &str,
    method: &str,
) -> HostTelemetryMetric<T> {
    let status = if value.is_some() {
        HardwareMetricStatus::Available
    } else {
        HardwareMetricStatus::Unavailable
    };
    HostTelemetryMetric {
        value,
        status,
        source: source.to_owned(),
        sampling_method,
        method: method.to_owned(),
        sampling_interval_ms,
        sample_count,
        interval_count,
    }
}

fn unavailable_host_window(duration: Duration) -> HostHardwareTelemetry {
    HostHardwareTelemetry {
        scope: TelemetryScope::Host,
        platform: current_platform(),
        window_duration_ms: duration.as_secs_f64() * 1_000.0,
        target_sampling_interval_ms: HOST_TELEMETRY_SAMPLE_INTERVAL.as_millis() as u64,
        raw_samples: Vec::new(),
        samples_truncated: false,
        cpu_utilization_percent: host_telemetry_metric(
            None::<f64>,
            HostTelemetrySamplingMethod::OsCounter,
            0,
            0,
            None,
            host_cpu_source(),
            "counter_delta_weighted_host_busy_percent",
        ),
        ram_average_bytes: host_telemetry_metric(
            None::<u64>,
            HostTelemetrySamplingMethod::OsSample,
            0,
            0,
            None,
            host_ram_source(),
            "periodic_host_memory_sampling",
        ),
        ram_peak_bytes: host_telemetry_metric(
            None::<u64>,
            HostTelemetrySamplingMethod::OsSample,
            0,
            0,
            None,
            host_ram_source(),
            "periodic_host_memory_sampling",
        ),
    }
}

fn host_cpu_source() -> &'static str {
    #[cfg(target_os = "linux")]
    {
        return "linux.procfs./proc/stat:cpu";
    }
    #[cfg(target_os = "windows")]
    {
        return "windows.kernel32.GetSystemTimes";
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        "not_detected"
    }
}

fn host_ram_source() -> &'static str {
    #[cfg(target_os = "linux")]
    {
        return "linux.procfs./proc/meminfo:MemTotal-MemAvailable";
    }
    #[cfg(target_os = "windows")]
    {
        return "windows.kernel32.GlobalMemoryStatusEx";
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        "not_detected"
    }
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn sample_host_window(
    stop_receiver: mpsc::Receiver<()>,
    started: Instant,
) -> HostHardwareTelemetry {
    let mut collector = HostTelemetryCollector::default();
    collector.record(read_host_resource_sample(), Instant::now(), started);
    loop {
        match stop_receiver.recv_timeout(HOST_TELEMETRY_SAMPLE_INTERVAL) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                collector.record(read_host_resource_sample(), Instant::now(), started);
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                collector.record(read_host_resource_sample(), Instant::now(), started);
            }
        }
    }
    collector.finish(started)
}

#[cfg(target_os = "linux")]
fn read_host_resource_sample() -> HostResourceSample {
    let cpu = read_bounded_file("/proc/stat", MAX_LINUX_CPUSTAT_BYTES)
        .and_then(|contents| parse_linux_cpu_stat(&contents));
    let ram_used_bytes = read_bounded_file("/proc/meminfo", MAX_LINUX_MEMINFO_BYTES)
        .and_then(|contents| parse_linux_used_memory(&contents));
    HostResourceSample {
        cpu,
        ram_used_bytes,
    }
}

#[cfg(target_os = "linux")]
fn read_bounded_file(path: &str, max_bytes: usize) -> Option<String> {
    let mut contents = String::new();
    File::open(path)
        .ok()?
        .take(max_bytes as u64)
        .read_to_string(&mut contents)
        .ok()?;
    Some(contents)
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Default)]
struct FileTime {
    low_date_time: u32,
    high_date_time: u32,
}

#[cfg(target_os = "windows")]
impl FileTime {
    fn ticks(&self) -> u64 {
        (u64::from(self.high_date_time) << 32) | u64::from(self.low_date_time)
    }
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Default)]
struct MemoryStatusEx {
    length: u32,
    memory_load: u32,
    total_physical: u64,
    available_physical: u64,
    total_page_file: u64,
    available_page_file: u64,
    total_virtual: u64,
    available_virtual: u64,
    available_extended_virtual: u64,
}

#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
extern "system" {
    fn GetSystemTimes(
        idle_time: *mut FileTime,
        kernel_time: *mut FileTime,
        user_time: *mut FileTime,
    ) -> i32;
    fn GlobalMemoryStatusEx(status: *mut MemoryStatusEx) -> i32;
}

#[cfg(target_os = "windows")]
fn read_host_resource_sample() -> HostResourceSample {
    let mut idle_time = FileTime::default();
    let mut kernel_time = FileTime::default();
    let mut user_time = FileTime::default();
    let cpu = (unsafe { GetSystemTimes(&mut idle_time, &mut kernel_time, &mut user_time) } != 0)
        .then(|| CpuCounters {
            total: kernel_time.ticks().saturating_add(user_time.ticks()),
            idle: idle_time.ticks(),
        });
    let mut memory = MemoryStatusEx {
        length: std::mem::size_of::<MemoryStatusEx>() as u32,
        ..MemoryStatusEx::default()
    };
    let ram_used_bytes = (unsafe { GlobalMemoryStatusEx(&mut memory) } != 0)
        .then_some(memory)
        .and_then(|memory| {
            (memory.total_physical > 0 && memory.available_physical <= memory.total_physical)
                .then(|| memory.total_physical - memory.available_physical)
        });
    HostResourceSample {
        cpu,
        ram_used_bytes,
    }
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn cpu_counter_deltas(previous: CpuCounters, current: CpuCounters) -> Option<(u64, u64)> {
    let total_delta = current.total.checked_sub(previous.total)?;
    let idle_delta = current.idle.checked_sub(previous.idle)?;
    if total_delta == 0 || idle_delta > total_delta {
        return None;
    }
    Some((total_delta, total_delta - idle_delta))
}

#[cfg(all(test, any(target_os = "linux", target_os = "windows")))]
fn cpu_utilization_percent(previous: CpuCounters, current: CpuCounters) -> Option<f64> {
    let (total_delta, busy_delta) = cpu_counter_deltas(previous, current)?;
    let value = busy_delta as f64 / total_delta as f64 * 100.0;
    value.is_finite().then(|| value.clamp(0.0, 100.0))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct GpuAdapterCandidate {
    description: String,
    dedicated_video_memory: u64,
    software: bool,
    vendor_id: u32,
    device_id: u32,
    subsystem_id: u32,
    revision: u32,
}

fn gpu_metrics() -> (HardwareMetric<String>, HardwareMetric<u64>) {
    #[cfg(target_os = "windows")]
    {
        return gpu_metrics_from_candidate(windows_gpu_candidate(), HardwareSource::WindowsDxgi);
    }
    #[cfg(not(target_os = "windows"))]
    {
        gpu_metrics_from_candidate(None, HardwareSource::NotDetected)
    }
}

fn gpu_metrics_from_candidate(
    candidate: Option<GpuAdapterCandidate>,
    source: HardwareSource,
) -> (HardwareMetric<String>, HardwareMetric<u64>) {
    match candidate {
        Some(candidate) => (
            HardwareMetric::available(candidate.description, source, HardwareConfidence::High),
            HardwareMetric::available(
                candidate.dedicated_video_memory,
                source,
                HardwareConfidence::High,
            ),
        ),
        None => (
            HardwareMetric::unavailable(source),
            HardwareMetric::unavailable(source),
        ),
    }
}

fn select_gpu_adapter(mut candidates: Vec<GpuAdapterCandidate>) -> Option<GpuAdapterCandidate> {
    candidates.sort_by(|left, right| {
        right
            .dedicated_video_memory
            .cmp(&left.dedicated_video_memory)
            .then_with(|| left.description.cmp(&right.description))
            .then_with(|| left.vendor_id.cmp(&right.vendor_id))
            .then_with(|| left.device_id.cmp(&right.device_id))
            .then_with(|| left.subsystem_id.cmp(&right.subsystem_id))
            .then_with(|| left.revision.cmp(&right.revision))
    });
    candidates
        .into_iter()
        .find(|candidate| !candidate.software && !candidate.description.is_empty())
}

fn decode_adapter_description(description: &[u16]) -> String {
    String::from_utf16_lossy(description)
        .trim_end_matches('\0')
        .trim()
        .to_owned()
}

#[cfg(target_os = "windows")]
const MAX_DXGI_ADAPTERS: u32 = 64;

#[cfg(target_os = "windows")]
fn windows_gpu_candidate() -> Option<GpuAdapterCandidate> {
    let factory = unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }.ok()?;
    let mut candidates = Vec::new();
    for index in 0..MAX_DXGI_ADAPTERS {
        let adapter = match unsafe { factory.EnumAdapters1(index) } {
            Ok(adapter) => adapter,
            Err(_) => break,
        };
        let description = match unsafe { adapter.GetDesc1() } {
            Ok(description) => description,
            Err(_) => continue,
        };
        candidates.push(GpuAdapterCandidate {
            description: decode_adapter_description(&description.Description),
            dedicated_video_memory: description.DedicatedVideoMemory as u64,
            software: description.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0,
            vendor_id: description.VendorId,
            device_id: description.DeviceId,
            subsystem_id: description.SubSysId,
            revision: description.Revision,
        });
    }
    select_gpu_adapter(candidates)
}

#[cfg(target_os = "linux")]
fn parse_linux_memory_metric() -> HardwareMetric<u64> {
    let memory_bytes = File::open("/proc/meminfo").ok().and_then(|file| {
        let mut contents = String::new();
        file.take(MAX_LINUX_MEMINFO_BYTES as u64)
            .read_to_string(&mut contents)
            .ok()?;
        parse_linux_meminfo(&contents)
    });
    memory_bytes.map_or_else(
        || HardwareMetric::unavailable(HardwareSource::LinuxProcfs),
        |bytes| {
            HardwareMetric::available(bytes, HardwareSource::LinuxProcfs, HardwareConfidence::High)
        },
    )
}

#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
extern "system" {
    fn GetPhysicallyInstalledSystemMemory(total_memory_in_kilobytes: *mut u64) -> i32;
}

#[cfg(target_os = "windows")]
fn windows_memory_metric() -> HardwareMetric<u64> {
    let mut memory_kib = 0_u64;
    let success = unsafe { GetPhysicallyInstalledSystemMemory(&mut memory_kib) } != 0;
    memory_kib
        .checked_mul(1024)
        .filter(|bytes| success && *bytes > 0)
        .map_or_else(
            || HardwareMetric::unavailable(HardwareSource::WindowsKernel32),
            |bytes| {
                HardwareMetric::available(
                    bytes,
                    HardwareSource::WindowsKernel32,
                    HardwareConfidence::High,
                )
            },
        )
}

#[cfg(any(target_os = "linux", test))]
fn parse_linux_meminfo(input: &str) -> Option<u64> {
    parse_linux_meminfo_kib(input, "MemTotal")?.checked_mul(1024)
}

#[cfg(any(target_os = "linux", test))]
fn parse_linux_used_memory(input: &str) -> Option<u64> {
    let total = parse_linux_meminfo(input)?;
    let available = parse_linux_meminfo_kib(input, "MemAvailable")?.checked_mul(1024)?;
    total.checked_sub(available)
}

#[cfg(any(target_os = "linux", test))]
fn parse_linux_meminfo_kib(input: &str, name: &str) -> Option<u64> {
    input.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        if key.trim() != name {
            return None;
        }
        let mut fields = value.split_whitespace();
        let kib = fields.next()?.parse::<u64>().ok()?;
        if fields.next()? != "kB" {
            return None;
        }
        Some(kib)
    })
}

#[cfg(any(target_os = "linux", test))]
fn parse_linux_cpu_stat(input: &str) -> Option<CpuCounters> {
    let line = input
        .lines()
        .find(|line| line.split_whitespace().next() == Some("cpu"))?;
    let fields = line
        .split_whitespace()
        .skip(1)
        .take(8)
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if fields.len() < 4 {
        return None;
    }
    let total = fields
        .iter()
        .try_fold(0_u64, |sum, value| sum.checked_add(*value))?;
    let idle = fields[3].checked_add(fields.get(4).copied().unwrap_or(0))?;
    (total > 0 && idle <= total).then_some(CpuCounters { total, idle })
}

#[cfg(test)]
mod tests {
    use super::{
        cpu_counter_deltas, cpu_utilization_percent, decode_adapter_description,
        gpu_metrics_from_candidate, parse_linux_cpu_stat, parse_linux_meminfo,
        parse_linux_used_memory, select_gpu_adapter, CpuCounters, GpuAdapterCandidate,
        HardwareConfidence, HardwareMetric, HardwareMetricStatus, HardwareSource,
        HostResourceSample, HostTelemetryCollector, HostTelemetrySamplingMethod, TelemetryScope,
        MAX_HOST_TELEMETRY_SAMPLES,
    };
    use std::time::{Duration, Instant};

    #[test]
    fn linux_meminfo_parser_requires_mem_total_in_kib() {
        assert_eq!(
            parse_linux_meminfo("MemFree: 10 kB\nMemTotal: 4096 kB\n"),
            Some(4_194_304)
        );
        assert_eq!(parse_linux_meminfo("MemTotal: 4096 MB\n"), None);
        assert_eq!(parse_linux_meminfo("MemAvailable: 4096 kB\n"), None);
    }

    #[test]
    fn linux_cpu_parser_uses_aggregate_counter_and_ignores_guest_double_count() {
        let counters =
            parse_linux_cpu_stat("cpu0 999 0 0 999 0 0 0 0\ncpu 120 0 0 80 5 0 0 0 900 900\n")
                .expect("aggregate CPU counters");
        assert_eq!(counters.total, 205);
        assert_eq!(counters.idle, 85);
        assert_eq!(parse_linux_cpu_stat("cpu 1 2 3\n"), None);
    }

    #[test]
    fn linux_memory_use_requires_both_total_and_available_values() {
        assert_eq!(
            parse_linux_used_memory("MemTotal: 100 kB\nMemAvailable: 40 kB\n"),
            Some(61_440)
        );
        assert_eq!(
            parse_linux_used_memory("MemTotal: 100 kB\nMemAvailable: 101 kB\n"),
            None
        );
        assert_eq!(parse_linux_used_memory("MemTotal: 100 kB\n"), None);
    }

    #[test]
    fn cpu_counter_delta_is_host_capacity_percent_and_rejects_invalid_intervals() {
        let before = CpuCounters {
            total: 200,
            idle: 100,
        };
        let after = CpuCounters {
            total: 230,
            idle: 110,
        };
        assert!(
            (cpu_utilization_percent(before, after).unwrap() - (2.0 / 3.0 * 100.0)).abs() < 0.001
        );
        assert_eq!(cpu_utilization_percent(before, before), None);
        assert_eq!(
            cpu_utilization_percent(
                before,
                CpuCounters {
                    total: 210,
                    idle: 120
                }
            ),
            None
        );
    }

    #[test]
    fn host_window_aggregates_cpu_counter_deltas_and_ram_os_samples_with_provenance() {
        let started = Instant::now();
        let mut collector = HostTelemetryCollector::default();
        collector.record(
            HostResourceSample {
                cpu: Some(CpuCounters {
                    total: 200,
                    idle: 100,
                }),
                ram_used_bytes: Some(100),
            },
            started,
            started,
        );
        collector.record(
            HostResourceSample {
                cpu: Some(CpuCounters {
                    total: 230,
                    idle: 110,
                }),
                ram_used_bytes: Some(200),
            },
            started + Duration::from_millis(100),
            started,
        );
        collector.record(
            HostResourceSample {
                cpu: Some(CpuCounters {
                    total: 260,
                    idle: 120,
                }),
                ram_used_bytes: Some(400),
            },
            started + Duration::from_millis(200),
            started,
        );

        let telemetry = collector.finish(started);
        assert_eq!(telemetry.scope, TelemetryScope::Host);
        assert_eq!(
            telemetry.cpu_utilization_percent.status,
            HardwareMetricStatus::Available
        );
        assert!(
            (telemetry.cpu_utilization_percent.value.unwrap() - (2.0 / 3.0 * 100.0)).abs() < 0.001
        );
        assert_eq!(
            telemetry.cpu_utilization_percent.sampling_method,
            HostTelemetrySamplingMethod::OsCounter
        );
        assert_eq!(
            telemetry.cpu_utilization_percent.method,
            "counter_delta_weighted_host_busy_percent"
        );
        assert_eq!(telemetry.cpu_utilization_percent.sample_count, 3);
        assert_eq!(telemetry.cpu_utilization_percent.interval_count, 2);
        assert_eq!(
            telemetry.cpu_utilization_percent.sampling_interval_ms,
            Some(100.0)
        );
        assert_eq!(telemetry.ram_average_bytes.value, Some(233));
        assert_eq!(telemetry.ram_peak_bytes.value, Some(400));
        assert_eq!(telemetry.ram_average_bytes.sample_count, 3);
        assert_eq!(telemetry.ram_average_bytes.interval_count, 2);
        assert_eq!(
            telemetry.ram_average_bytes.sampling_method,
            HostTelemetrySamplingMethod::OsSample
        );
        assert_eq!(
            telemetry.ram_average_bytes.sampling_interval_ms,
            Some(100.0)
        );
        assert_eq!(
            telemetry.cpu_utilization_percent.source,
            super::host_cpu_source()
        );
        assert_eq!(
            telemetry.ram_average_bytes.method,
            "sampled_host_physical_used_mean"
        );
        assert_eq!(telemetry.target_sampling_interval_ms, 1_000);
        assert_eq!(telemetry.raw_samples.len(), 3);
        assert!(!telemetry.samples_truncated);
    }

    #[test]
    fn cpu_aggregate_weights_unequal_counter_deltas_instead_of_averaging_intervals() {
        let started = Instant::now();
        let mut collector = HostTelemetryCollector::default();
        for (elapsed_ms, total, idle) in [
            (0, 100, 50),
            (100, 110, 51), // 9/10 busy = 90%
            (300, 200, 82), // 59/90 busy; weighted total is 68/100 = 68%
        ] {
            collector.record(
                HostResourceSample {
                    cpu: Some(CpuCounters { total, idle }),
                    ram_used_bytes: None,
                },
                started + Duration::from_millis(elapsed_ms),
                started,
            );
        }

        let telemetry = collector.finish(started);
        assert!((telemetry.cpu_utilization_percent.value.unwrap() - 68.0).abs() < 0.001);
        assert_eq!(telemetry.cpu_utilization_percent.sample_count, 3);
        assert_eq!(telemetry.cpu_utilization_percent.interval_count, 2);
        assert_eq!(
            telemetry.cpu_utilization_percent.sampling_interval_ms,
            Some(150.0)
        );
    }

    #[test]
    fn ram_sampling_interval_spans_missing_os_reads_and_counts_valid_pairs_only() {
        let started = Instant::now();
        let mut collector = HostTelemetryCollector::default();
        for (elapsed_ms, ram_used_bytes) in [(0, Some(100)), (100, None), (300, Some(300))] {
            collector.record(
                HostResourceSample {
                    cpu: None,
                    ram_used_bytes,
                },
                started + Duration::from_millis(elapsed_ms),
                started,
            );
        }

        let telemetry = collector.finish(started);
        assert_eq!(telemetry.ram_average_bytes.value, Some(200));
        assert_eq!(telemetry.ram_peak_bytes.value, Some(300));
        assert_eq!(telemetry.ram_average_bytes.sample_count, 2);
        assert_eq!(telemetry.ram_average_bytes.interval_count, 1);
        assert_eq!(
            telemetry.ram_average_bytes.sampling_interval_ms,
            Some(300.0)
        );
        assert_eq!(telemetry.raw_samples[1].3, None);
    }

    #[test]
    fn compact_raw_samples_recompute_aggregates_and_preserve_exact_cpu_counters() {
        let started = Instant::now();
        let mut collector = HostTelemetryCollector::default();
        let base = 9_007_199_254_741_000_u64;
        for (elapsed_ms, total, idle, ram_used_bytes) in [
            (0, base, 4_000_000_000, Some(100)),
            (100, base + 10, 4_000_000_001, Some(200)),
            (300, base + 100, 4_000_000_032, Some(400)),
        ] {
            collector.record(
                HostResourceSample {
                    cpu: Some(CpuCounters { total, idle }),
                    ram_used_bytes,
                },
                started + Duration::from_millis(elapsed_ms),
                started,
            );
        }

        let telemetry = collector.finish(started);
        let serialized = serde_json::to_value(&telemetry).expect("host telemetry JSON");
        assert_eq!(serialized["rawSamples"][0][1], base.to_string());
        assert_eq!(serialized["rawSamples"][0][2], "4000000000");
        assert_eq!(serialized["samplesTruncated"], false);

        let mut total_delta = 0_u128;
        let mut busy_delta = 0_u128;
        for pair in telemetry.raw_samples.windows(2) {
            let previous = CpuCounters {
                total: pair[0].1.as_deref().unwrap().parse().unwrap(),
                idle: pair[0].2.as_deref().unwrap().parse().unwrap(),
            };
            let current = CpuCounters {
                total: pair[1].1.as_deref().unwrap().parse().unwrap(),
                idle: pair[1].2.as_deref().unwrap().parse().unwrap(),
            };
            let (interval_total, interval_busy) = cpu_counter_deltas(previous, current).unwrap();
            total_delta += u128::from(interval_total);
            busy_delta += u128::from(interval_busy);
        }
        let recomputed_cpu = busy_delta as f64 / total_delta as f64 * 100.0;
        let ram_values = telemetry.raw_samples.iter().filter_map(|sample| sample.3);
        let ram_values = ram_values.collect::<Vec<_>>();
        let recomputed_ram = (ram_values
            .iter()
            .map(|value| u128::from(*value))
            .sum::<u128>()
            / ram_values.len() as u128) as u64;
        let recomputed_peak = *ram_values.iter().max().unwrap();
        assert!((telemetry.cpu_utilization_percent.value.unwrap() - recomputed_cpu).abs() < 0.001);
        assert_eq!(telemetry.ram_average_bytes.value, Some(recomputed_ram));
        assert_eq!(telemetry.ram_peak_bytes.value, Some(recomputed_peak));
    }

    #[test]
    fn raw_sample_cap_is_explicit_while_aggregates_continue_after_truncation() {
        let started = Instant::now();
        let mut collector = HostTelemetryCollector::default();
        for index in 0..(MAX_HOST_TELEMETRY_SAMPLES + 2) {
            let index = index as u64;
            collector.record(
                HostResourceSample {
                    cpu: Some(CpuCounters {
                        total: 100 + index * 10,
                        idle: 50 + index * 5,
                    }),
                    ram_used_bytes: Some(100 + index),
                },
                started + Duration::from_millis(index * 1_000),
                started,
            );
        }

        let telemetry = collector.finish(started);
        assert_eq!(telemetry.raw_samples.len(), MAX_HOST_TELEMETRY_SAMPLES);
        assert!(telemetry.samples_truncated);
        assert_eq!(telemetry.cpu_utilization_percent.sample_count, 8_194);
        assert_eq!(telemetry.cpu_utilization_percent.interval_count, 8_193);
        assert_eq!(telemetry.cpu_utilization_percent.value, Some(50.0));
        assert_eq!(telemetry.ram_average_bytes.sample_count, 8_194);
        assert_eq!(telemetry.ram_peak_bytes.value, Some(8_293));
        assert_eq!(telemetry.raw_samples.last().unwrap().3, Some(8_291));
    }

    #[test]
    fn host_window_with_no_samples_keeps_metrics_unavailable() {
        let telemetry = HostTelemetryCollector::default().finish(Instant::now());
        assert_eq!(
            telemetry.cpu_utilization_percent.status,
            HardwareMetricStatus::Unavailable
        );
        assert_eq!(telemetry.cpu_utilization_percent.value, None);
        assert_eq!(
            telemetry.ram_average_bytes.status,
            HardwareMetricStatus::Unavailable
        );
        assert_eq!(telemetry.ram_peak_bytes.value, None);
    }

    #[test]
    fn unavailable_metric_is_explicit_and_non_guessing() {
        let metric: HardwareMetric<u64> = HardwareMetric::unavailable(HardwareSource::NotDetected);
        assert_eq!(metric.value, None);
        assert_eq!(metric.status, HardwareMetricStatus::Unavailable);
        assert_eq!(metric.confidence, HardwareConfidence::Unavailable);
        assert_eq!(metric.source, HardwareSource::NotDetected);
    }

    #[test]
    fn adapter_description_parser_trims_utf16_nul_terminators() {
        let mut description = [0_u16; 8];
        description[..4].copy_from_slice(&['G' as u16, 'P' as u16, 'U' as u16, 0]);
        assert_eq!(decode_adapter_description(&description), "GPU");
    }

    #[test]
    fn adapter_selection_ignores_software_and_prefers_dedicated_memory() {
        let candidate = |description: &str, memory: u64, software: bool| GpuAdapterCandidate {
            description: description.to_owned(),
            dedicated_video_memory: memory,
            software,
            vendor_id: 0,
            device_id: 0,
            subsystem_id: 0,
            revision: 0,
        };
        let selected = select_gpu_adapter(vec![
            candidate("Software", 32 * 1024 * 1024 * 1024, true),
            candidate("Integrated", 2 * 1024 * 1024 * 1024, false),
            candidate("Discrete", 8 * 1024 * 1024 * 1024, false),
        ])
        .expect("a hardware adapter remains");
        assert_eq!(selected.description, "Discrete");
        assert_eq!(selected.dedicated_video_memory, 8 * 1024 * 1024 * 1024);

        let tie = select_gpu_adapter(vec![
            candidate("Zulu", 8 * 1024 * 1024 * 1024, false),
            candidate("Alpha", 8 * 1024 * 1024 * 1024, false),
        ])
        .expect("a tied hardware adapter remains");
        assert_eq!(tie.description, "Alpha");
    }

    #[test]
    fn available_gpu_metrics_report_dxgi_source() {
        let candidate = GpuAdapterCandidate {
            description: "Discrete".to_owned(),
            dedicated_video_memory: 8 * 1024 * 1024 * 1024,
            software: false,
            vendor_id: 1,
            device_id: 2,
            subsystem_id: 3,
            revision: 4,
        };
        let (gpu_name, vram_bytes) =
            gpu_metrics_from_candidate(Some(candidate), HardwareSource::WindowsDxgi);
        assert_eq!(gpu_name.source, HardwareSource::WindowsDxgi);
        assert_eq!(vram_bytes.source, HardwareSource::WindowsDxgi);
        assert_eq!(gpu_name.value.as_deref(), Some("Discrete"));
        assert_eq!(vram_bytes.value, Some(8 * 1024 * 1024 * 1024));
    }

    #[test]
    fn gpu_detection_failure_stays_unavailable() {
        let (gpu_name, vram_bytes) = gpu_metrics_from_candidate(None, HardwareSource::WindowsDxgi);
        assert_eq!(gpu_name.status, HardwareMetricStatus::Unavailable);
        assert_eq!(vram_bytes.status, HardwareMetricStatus::Unavailable);
        assert_eq!(gpu_name.value, None);
        assert_eq!(vram_bytes.value, None);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn snapshot_keeps_gpu_and_vram_unavailable_without_feature_detection() {
        let snapshot = super::read_hardware_snapshot();
        assert_eq!(snapshot.gpu_name.status, HardwareMetricStatus::Unavailable);
        assert_eq!(
            snapshot.vram_bytes.status,
            HardwareMetricStatus::Unavailable
        );
        assert_eq!(snapshot.gpu_name.value, None);
        assert_eq!(snapshot.vram_bytes.value, None);
        let serialized = serde_json::to_value(snapshot).expect("typed hardware snapshot");
        assert!(serialized.get("logicalCpuCount").is_some());
        assert_eq!(serialized["gpuName"]["value"], serde_json::Value::Null);
        assert_eq!(serialized["vramBytes"]["status"], "unavailable");
    }
}
