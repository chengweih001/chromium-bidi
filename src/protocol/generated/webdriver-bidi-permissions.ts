/**
 * Copyright 2024 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * THIS FILE IS AUTOGENERATED by cddlconv 0.1.6.
 * Run `node tools/generate-bidi-types.mjs` to regenerate.
 * @see https://github.com/w3c/webdriver-bidi/blob/master/index.bs
 */

export type PermissionsCommand = Permissions.SetPermission;
export namespace Permissions {
  export type PermissionDescriptor = {
    name: string;
  };
}
export namespace Permissions {
  export const enum PermissionState {
    Granted = 'granted',
    Denied = 'denied',
    Prompt = 'prompt',
  }
}
export namespace Permissions {
  export type SetPermission = {
    method: 'permissions.setPermission';
    params: Permissions.SetPermissionParameters;
  };
}
export namespace Permissions {
  export type SetPermissionParameters = {
    descriptor: Permissions.PermissionDescriptor;
    state: Permissions.PermissionState;
    origin: string;
    userContext?: string;
  };
}
