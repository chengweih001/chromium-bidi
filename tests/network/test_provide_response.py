#  Copyright 2023 Google LLC.
#  Copyright (c) Microsoft Corporation.
#
#  Licensed under the Apache License, Version 2.0 (the "License");
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.
import re

import pytest
from anys import ANY_DICT, ANY_LIST, ANY_NUMBER, ANY_STR
from test_helpers import (ANY_TIMESTAMP, ANY_UUID, AnyExtending,
                          execute_command, send_JSON_command, subscribe,
                          wait_for_command, wait_for_event)

from . import create_blocked_request


@pytest.mark.asyncio
async def test_provide_response_non_existent_request(websocket):
    with pytest.raises(
            Exception,
            match=str({
                "error": "no such request",
                "message": "Network request with ID '_UNKNOWN_' doesn't exist"
            })):
        await execute_command(
            websocket, {
                "method": "network.provideResponse",
                "params": {
                    "request": '_UNKNOWN_',
                },
            })


@pytest.mark.asyncio
async def test_provide_response_beforeRequestSent_is_valid_phase(
        websocket, context_id, url_example):
    network_id = await create_blocked_request(websocket,
                                              context_id,
                                              url=url_example,
                                              phase="beforeRequestSent")

    # No exception should be thrown.
    await execute_command(
        websocket, {
            "method": "network.provideResponse",
            "params": {
                "request": network_id,
                "statusCode": 200,
            },
        })


@pytest.mark.asyncio
async def test_provide_response_invalid_status_code(websocket, context_id,
                                                    url_example):
    network_id = await create_blocked_request(websocket,
                                              context_id,
                                              url=url_example,
                                              phase="beforeRequestSent")

    with pytest.raises(
            Exception,
            match=re.compile(
                str({
                    "error": "invalid argument",
                    "message": 'Number must be greater than or equal to 0 in "statusCode".*'
                }))):
        await execute_command(
            websocket, {
                "method": "network.provideResponse",
                "params": {
                    "request": network_id,
                    "statusCode": -1,
                },
            })


@pytest.mark.asyncio
async def test_provide_response_invalid_reason_phrase(websocket, context_id,
                                                      url_example):
    network_id = await create_blocked_request(websocket,
                                              context_id,
                                              url=url_example,
                                              phase="beforeRequestSent")

    with pytest.raises(
            Exception,
            match=str({
                "error": "invalid argument",
                "message": 'Expected string, received array in "reasonPhrase".'
            })):
        await execute_command(
            websocket, {
                "method": "network.provideResponse",
                "params": {
                    "request": network_id,
                    "reasonPhrase": [],
                },
            })


@pytest.mark.asyncio
async def test_provide_response_invalid_headers(websocket, context_id,
                                                url_example):
    network_id = await create_blocked_request(websocket,
                                              context_id,
                                              url=url_example,
                                              phase="beforeRequestSent")

    with pytest.raises(
            Exception,
            match=str({
                "error": "invalid argument",
                "message": 'Expected array, received string in "headers".'
            })):
        await execute_command(
            websocket, {
                "method": "network.provideResponse",
                "params": {
                    "request": network_id,
                    "headers": "",
                },
            })


@pytest.mark.asyncio
async def test_provide_response_invalid_body(websocket, context_id,
                                             url_example):
    network_id = await create_blocked_request(websocket,
                                              context_id,
                                              url=url_example,
                                              phase="beforeRequestSent")

    with pytest.raises(Exception,
                       match=str({
                           "error": "invalid argument",
                           "message": 'Invalid input in "body".'
                       })):
        await execute_command(
            websocket, {
                "method": "network.provideResponse",
                "params": {
                    "request": network_id,
                    "body": {
                        "type": "string",
                        "value": 42,
                    },
                },
            })


@pytest.mark.asyncio
async def test_provide_response_non_blocked_request(websocket, context_id,
                                                    assert_no_events_in_queue,
                                                    url_hang_forever):
    await subscribe(websocket, [
        "network.beforeRequestSent", "network.responseCompleted",
        "network.fetchError"
    ])

    await send_JSON_command(
        websocket, {
            "method": "browsingContext.navigate",
            "params": {
                "url": url_hang_forever,
                "context": context_id,
                "wait": "complete",
            }
        })

    before_request_sent_event = await wait_for_event(
        websocket, "network.beforeRequestSent")

    # Assert these events never happen, otherwise the test is ineffective.
    await assert_no_events_in_queue(
        ["network.responseCompleted", "network.fetchError"], timeout=1.0)

    assert not before_request_sent_event["params"]["isBlocked"]

    network_id = before_request_sent_event["params"]["request"]["request"]

    with pytest.raises(
            Exception,
            match=str({
                "error": "no such request",
                "message": f"No blocked request found for network id '{network_id}'",
            })):
        await execute_command(
            websocket, {
                "method": "network.provideResponse",
                "params": {
                    "request": network_id,
                },
            })


@pytest.mark.asyncio
@pytest.mark.skip(reason="CDP does not update the response correctly")
async def test_provide_response_completes(websocket, context_id, url_example):
    await subscribe(websocket,
                    ["network.responseStarted", "network.responseCompleted"],
                    [context_id])

    await execute_command(
        websocket, {
            "method": "network.addIntercept",
            "params": {
                "phases": ["responseStarted"],
                "urlPatterns": [{
                    "type": "string",
                    "pattern": url_example,
                }, ],
            },
        })

    await send_JSON_command(
        websocket, {
            "method": "browsingContext.navigate",
            "params": {
                "url": url_example,
                "context": context_id,
                "wait": "complete",
            }
        })

    event_response = await wait_for_event(websocket, "network.responseStarted")
    assert event_response == {
        "method": "network.responseStarted",
        "params": {
            "context": context_id,
            "intercepts": ANY_LIST,
            "isBlocked": True,
            "navigation": ANY_STR,
            "redirectCount": 0,
            "request": {
                "request": ANY_STR,
                "url": url_example,
                "method": "GET",
                "headers": ANY_LIST,
                "cookies": [],
                "headersSize": ANY_NUMBER,
                "bodySize": 0,
                "timings": ANY_DICT,
            },
            "response": ANY_DICT,
            "timestamp": ANY_TIMESTAMP,
        },
        "type": "event",
    }
    network_id = event_response["params"]["request"]["request"]

    await execute_command(
        websocket, {
            "method": "network.provideResponse",
            "params": {
                "request": network_id,
                "statusCode": 501,
                "reasonPhrase": "Remember to drink water",
                "headers": [{
                    "name": "header1",
                    "value": {
                        "type": "string",
                        "value": "value1",
                    }
                }],
                "body": {
                    "type": "string",
                    "value": "my body",
                },
            },
        })

    event_response = await wait_for_event(websocket,
                                          "network.responseCompleted")
    assert event_response == {
        "method": "network.responseCompleted",
        "params": {
            "context": context_id,
            "isBlocked": False,
            "navigation": ANY_STR,
            "redirectCount": 0,
            "request": ANY_DICT,
            "response": AnyExtending({
                # TODO: Ensure body is "my body".
                "headers": [{
                    "name": "header1",
                    "value": {
                        "type": "string",
                        "value": "value1",
                    },
                }, ],
                "url": url_example,
                "status": 501,
                "statusText": "Remember to drink water",
            }),
            "timestamp": ANY_TIMESTAMP,
        },
        "type": "event",
    }


@pytest.mark.asyncio
async def test_provide_response_twice(websocket, context_id, url_example):
    await subscribe(websocket,
                    ["network.responseStarted", "network.responseCompleted"],
                    [context_id])

    await execute_command(
        websocket, {
            "method": "network.addIntercept",
            "params": {
                "phases": ["responseStarted"],
                "urlPatterns": [{
                    "type": "string",
                    "pattern": url_example,
                }, ],
            },
        })

    await send_JSON_command(
        websocket, {
            "method": "browsingContext.navigate",
            "params": {
                "url": url_example,
                "context": context_id,
                "wait": "complete",
            }
        })

    event_response = await wait_for_event(websocket, "network.responseStarted")
    assert event_response == AnyExtending({
        "method": "network.responseStarted",
        "params": {
            "context": context_id,
            "intercepts": ANY_LIST,
            "isBlocked": True,
            "navigation": ANY_STR,
            "redirectCount": 0,
            "request": {
                "request": ANY_STR,
                "url": url_example,
                "method": "GET",
                "headers": ANY_LIST,
                "cookies": [],
                "headersSize": ANY_NUMBER,
                "bodySize": 0,
                "timings": ANY_DICT,
            },
            "response": ANY_DICT,
            "timestamp": ANY_TIMESTAMP,
        },
        "type": "event",
    })
    network_id = event_response["params"]["request"]["request"]

    await execute_command(
        websocket, {
            "method": "network.provideResponse",
            "params": {
                "request": network_id,
                "statusCode": 200,
            },
        })

    event_response = await wait_for_event(websocket,
                                          "network.responseCompleted")

    with pytest.raises(
            Exception,
            match=str({
                "error": "no such request",
                "message": f"Network request with ID '{network_id}' doesn't exist"
            })):
        await execute_command(
            websocket, {
                "method": "network.provideResponse",
                "params": {
                    "request": network_id,
                    "statusCode": 200,
                },
            })


@pytest.mark.asyncio
@pytest.mark.skip(reason="TODO: #1890")
async def test_provide_response_remove_intercept_inflight_request(
        websocket, context_id, url_example):
    await subscribe(websocket,
                    ["network.beforeRequestSent", "network.responseCompleted"],
                    [context_id])

    result = await execute_command(
        websocket, {
            "method": "network.addIntercept",
            "params": {
                "phases": ["responseStarted"],
                "urlPatterns": [{
                    "type": "string",
                    "pattern": url_example,
                }, ],
            },
        })

    assert result == {
        "intercept": ANY_UUID,
    }
    intercept_id = result["intercept"]

    await send_JSON_command(
        websocket, {
            "method": "browsingContext.navigate",
            "params": {
                "url": url_example,
                "context": context_id,
                "wait": "complete",
            }
        })

    event_response = await wait_for_event(websocket,
                                          "network.beforeRequestSent")
    assert event_response == {
        "method": "network.beforeRequestSent",
        "params": {
            "context": context_id,
            "initiator": {
                "type": "other",
            },
            "isBlocked": True,
            "navigation": ANY_STR,
            "redirectCount": 0,
            "request": {
                "request": ANY_STR,
                "url": url_example,
                "method": "GET",
                "headers": ANY_LIST,
                "cookies": [],
                "headersSize": ANY_NUMBER,
                "bodySize": 0,
                "timings": ANY_DICT,
            },
            "timestamp": ANY_TIMESTAMP,
        },
        "type": "event",
    }
    network_id = event_response["params"]["request"]["request"]

    result = await execute_command(
        websocket, {
            "method": "network.removeIntercept",
            "params": {
                "intercept": intercept_id,
            },
        })
    assert result == {}

    await execute_command(
        websocket, {
            "method": "network.provideResponse",
            "params": {
                "request": network_id,
                "statusCode": 200,
            },
        })

    event_response = await wait_for_event(websocket,
                                          "network.responseCompleted")
    assert event_response == {
        "method": "network.responseCompleted",
        "params": {
            "context": context_id,
            "isBlocked": False,
            "navigation": ANY_STR,
            "redirectCount": 0,
            "request": ANY_DICT,
            "response": ANY_DICT,
            "timestamp": ANY_TIMESTAMP,
        },
        "type": "event",
    }


@pytest.mark.asyncio
async def test_provide_response_works_with_non_latin(websocket, context_id,
                                                     url_example):
    await subscribe(websocket,
                    ["network.responseStarted", "network.responseCompleted"],
                    [context_id])

    await execute_command(
        websocket, {
            "method": "network.addIntercept",
            "params": {
                "phases": ["responseStarted"],
                "urlPatterns": [{
                    "type": "string",
                    "pattern": url_example,
                }, ],
            },
        })

    command_id = await send_JSON_command(
        websocket, {
            "method": "browsingContext.navigate",
            "params": {
                "url": url_example,
                "context": context_id,
                "wait": "complete",
            }
        })

    event_response = await wait_for_event(websocket, "network.responseStarted")
    network_id = event_response["params"]["request"]["request"]

    await execute_command(
        websocket, {
            "method": "network.provideResponse",
            "params": {
                "request": network_id,
                "headers": [{
                    "name": "Content-Type",
                    "value": {
                        "type": "string",
                        "value": "text/plain; charset=utf-8",
                    }
                }],
                "body": {
                    "type": "string",
                    "value": "Hello 🌍!",
                },
            },
        })

    # Wait for the navigation to complete
    # Else we may try to execute the command
    # while there is no realm
    await wait_for_command(websocket, command_id)

    result = await execute_command(
        websocket, {
            "method": "script.evaluate",
            "params": {
                "expression": "document.documentElement.innerText",
                "target": {
                    "context": context_id
                },
                "awaitPromise": False,
            }
        })

    assert result['result']['value'] == "Hello 🌍!"
