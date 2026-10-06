export const STATUSES = ["Open", "InProgress", "Pending", "Awaiting User", "Escalated", "Resolved", "Closed"] as const;
export const PRIORITIES = ["Critical", "High", "Medium", "Low"] as const;
export const CATEGORIES = ["Email", "Laptop/Desktop", "Network/Wi-Fi", "VPN", "Windows 365", "SaaS/Application", "User Account", "Password/MFA", "Security"] as const;
export const REQUEST_OPTIONS: Record<string, string[]> = {
  Incident: ["Network Issue", "Application Error", "Device Troubleshooting"],
  "Service Request": ["New Employee / Onboarding", "Offboarding", "VPN Access Request", "Windows 365 cloud PC Provisioning"],
};
