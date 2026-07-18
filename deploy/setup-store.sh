#!/usr/bin/env bash
# Copyright 2026 Alexander L. Penny
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Prepare the USB image store.  Usage:  sudo bash setup-store.sh /mnt/usb
set -euo pipefail

MOUNT="${1:-}"
if [ -z "$MOUNT" ]; then
  echo "Usage: sudo bash setup-store.sh /path/to/usb/mountpoint"
  echo
  echo "Available mountpoints:"
  lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT | grep -vE '^loop' | sed 's/^/  /'
  exit 1
fi

if ! mountpoint -q "$MOUNT"; then
  echo "ERROR: $MOUNT is not a mountpoint."
  echo "Mount the drive first, and add it to /etc/fstab so it comes back on reboot."
  exit 1
fi

STORE="$MOUNT/contactsheet/store"
mkdir -p "$STORE/.incoming"
chown -R contactsheet:contactsheet "$MOUNT/contactsheet"
chmod 750 "$MOUNT/contactsheet" "$STORE"

# The marker proves the real drive is mounted. If the USB is absent, this file
# is missing and the service refuses to start rather than writing to the SD
# card underneath the empty mountpoint.
touch "$STORE/.store-ok"
chown contactsheet:contactsheet "$STORE/.store-ok"

echo "Store ready: $STORE"
echo
echo "Now set these in the systemd unit, then reload:"
echo "  RequiresMountsFor=$MOUNT"
echo "  Environment=STORE_DIR=$STORE"
echo "  ReadWritePaths=/var/lib/contactsheet $MOUNT/contactsheet"
echo
echo "Confirm the drive is in /etc/fstab with 'nofail' so a missing USB does not"
echo "block boot:"
grep -E "$(findmnt -no SOURCE "$MOUNT" 2>/dev/null || echo NOTHING)" /etc/fstab 2>/dev/null \
  || echo "  WARNING: this drive does not appear in /etc/fstab -- it will not remount on reboot."
