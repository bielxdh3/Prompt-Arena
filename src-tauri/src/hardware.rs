use std::num::NonZeroUsize;

#[cfg(target_os = "linux")]
use std::{fs::File, io::Read};

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
    HardwareSnapshot {
        platform: current_platform(),
        logical_cpu_count: logical_cpu_metric(),
        memory_bytes: memory_metric(),
        gpu_name: HardwareMetric::unavailable(HardwareSource::NotDetected),
        vram_bytes: HardwareMetric::unavailable(HardwareSource::NotDetected),
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
        parse_linux_meminfo, read_hardware_snapshot, HardwareConfidence, HardwareMetric,
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
    fn snapshot_keeps_gpu_and_vram_unavailable_without_feature_detection() {
        let snapshot = read_hardware_snapshot();
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
