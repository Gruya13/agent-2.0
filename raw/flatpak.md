# Flatpak — izvod iz enciklopedijskog članka

Izvor: Wikipedia (en), članak "Flatpak", pristupljeno 14.10.2026.
URL: https://en.wikipedia.org/wiki/Flatpak
Licenca izvornog teksta: CC BY-SA 4.0.

Flatpak (known as xdg-app until 2016) is a utility for software deployment and package management for Linux. It provides a sandbox environment in which users can run application software, or "apps", in isolation from the rest of the system.

Applications using Flatpak need permissions to access resources such as Bluetooth, sound (with PipeWire), network, and files. These permissions are configured by the maintainer of the Flatpak and can be added or removed by users on their system.

Another key feature of Flatpak allows application developers to directly provide updates to users without going through Linux distributions, and without having to package and test the application separately for each distribution.

Because Flatpak runs in a sandbox, which provides a separate, ABI-stable version of common system libraries and operating system interfaces, it uses more space on the system than common native packages. However, OSTree, a technology underlying Flatpak, deduplicates matching files. This means that the first few Flatpak installations will occupy more space, but as more packages are added, the system will use space more efficiently.

Flathub, a centralized repository (or remote source in the Flatpak terminology) located at flathub.org, is the de facto standard for obtaining applications packaged with Flatpak. Packages are contributed by both Flathub administrators and application developers, with a stated preference for submissions directly from the application developers. By 2023, Flathub had more than 700,000 downloads per day.

Although Flathub is the de facto source for applications packaged with Flatpak, it is possible to host a Flatpak repository that is independent of Flathub.

Theoretically, Flatpak apps can be installed on any existing and future Linux distribution, including those installed with the Windows Subsystem for Linux compatibility layer, so long as Bubblewrap and OSTree are available. It can also be used on Linux kernel-based systems like ChromeOS.
