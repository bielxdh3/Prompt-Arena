use std::num::NonZeroUsize;

#[cfg(target_os = "linux")]
use std::{fs::File, io::Read};

#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
};

use serde::{Deserialize, Serialize};

#[cfg(target_os = "linux")]
const MAX_LINUX_MEMINFO_BYTES: usize = 64 * 1024;

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
    input.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        if key.trim() != "MemTotal" {
            return None;
        }
        let mut fields = value.split_whitespace();
        let kib = fields.next()?.parse::<u64>().ok()?;
        if fields.next()? != "kB" {
            return None;
        }
        kib.checked_mul(1024)
    })
}

#[cfg(test)]
mod tests {
    use super::{
        decode_adapter_description, gpu_metrics_from_candidate, parse_linux_meminfo,
        select_gpu_adapter, GpuAdapterCandidate, HardwareConfidence, HardwareMetric,
        HardwareMetricStatus, HardwareSource,
    };

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
