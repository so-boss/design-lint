figma.showUI(__html__, { width: 360, height: 600 });

let originalNodeTree = [];

figma.ui.onmessage = msg => {
  // Fetch a specific node by ID.
  if (msg.type === "fetch-layer-data") {
    let layer = figma.getNodeById(msg.id);
    let layerArray = [];

    // Using selection and viewport requires an array.
    layerArray.push(layer);

    // Moves the layer into focus and selects so the user can update it.
    figma.notify(`Layer ${layer.name} selected`, { timeout: 750 });
    figma.currentPage.selection = layerArray;
    figma.viewport.scrollAndZoomIntoView(layerArray);

    let layerData = JSON.stringify(layer, [
      "id",
      "name",
      "description",
      "fills",
      "key",
      "type",
      "remote",
      "paints",
      "fontName",
      "fontSize",
      "font"
    ]);

    figma.ui.postMessage({
      type: "fetched layer",
      message: layerData
    });
  }

  // Could this be made less expensive?
  if (msg.type === "update-errors") {
    figma.ui.postMessage({
      type: "updated errors",
      errors: lint(originalNodeTree)
    });
  }

  // Updates client storage with a new ignored error.
  if (msg.type === "update-storage") {
    let arrayToBeStored = JSON.stringify(msg.storageArray);
    figma.clientStorage.setAsync("storedErrorsToIgnore", arrayToBeStored);
  }

  // Clears all ignored errors
  if (msg.type === "update-storage-from-settings") {
    let arrayToBeStored = JSON.stringify(msg.storageArray);
    figma.clientStorage.setAsync("storedErrorsToIgnore", arrayToBeStored);

    figma.ui.postMessage({
      type: "reset storage",
      storage: arrayToBeStored
    });

    figma.notify("Cleared ignored errors", { timeout: 1000 });
  }

  if (msg.type === "select-multiple-layers") {
    const layerArray = msg.nodeArray;
    let nodesToBeSelected = [];

    layerArray.forEach(item => {
      let layer = figma.getNodeById(item);
      // Using selection and viewport requires an array.
      nodesToBeSelected.push(layer);
    });

    // Moves the layer into focus and selects so the user can update it.
    figma.currentPage.selection = nodesToBeSelected;
    figma.viewport.scrollAndZoomIntoView(nodesToBeSelected);
    figma.notify("Multiple layers selected", { timeout: 1000 });
  }

  // Traverses the node tree
  function traverse(node) {
    if ("children" in node) {
      if (node.type !== "INSTANCE") {
        for (const child of node.children) {
          traverse(child);
        }
      }
    }
    return node;
  }

  function traverseNodes(selection) {
    let traversedNodes = traverse(selection);

    return traversedNodes;
  }

  // Serialize nodes to pass back to the UI.
  function seralizeNodes(nodes) {
    let serializedNodes = JSON.stringify(nodes, [
      "name",
      "type",
      "children",
      "id"
    ]);

    return serializedNodes;
  }

  function lint(nodes) {
    let errorArray = [];
    let childArray = [];

    nodes.forEach(node => {
      // Create a new object.
      let newObject = {};

      // Give it the existing node id.
      newObject.id = node.id;

      // Check object for errors.
      newObject.errors = determineType(node);

      // Recursively run this function to flatten out children and grandchildren nodes
      if (node["children"]) {
        node["children"].forEach(childNode => {
          childArray.push(childNode.id);
        });
        newObject.children = childArray;
        errorArray.push(...lint(node["children"]));
      }

      errorArray.push(newObject);
    });

    return errorArray;
  }

  // Initalize the app
  if (msg.type === "run-app") {
    if (figma.currentPage.selection.length === 0) {
      figma.notify("Select a frame or multiple frames", { timeout: 2000 });
      return;
    } else {
      let nodes = traverseNodes(figma.currentPage.selection);

      // Maintain the original tree structure so we can enable
      // refreshing the tree and live updating errors.
      originalNodeTree = nodes;

      // Pass the array back to the UI to be displayed.
      figma.ui.postMessage({
        type: "complete",
        message: seralizeNodes(nodes),
        errors: lint(nodes)
      });

      figma.clientStorage.getAsync("storedErrorsToIgnore").then(result => {
        figma.ui.postMessage({
          type: "fetched storage",
          storage: result
        });
      });
    }
  }

  function determineType(node) {
    switch (node.type) {
      case "INSTANCE": {
        let errors = [];
        return errors;
      }
      case "ELLIPSE":
      case "POLYGON":
      case "STAR":
      case "LINE":
      case "BOOLEAN_OPERATION":
      case "FRAME":
      case "VECTOR":
      case "GROUP": {
        let errors = [];
        return errors;
      }
      case "RECTANGLE": {
        return lintShapeRules(node);
      }
      case "TEXT": {
        return lintTextRules(node);
      }
      case "COMPONENT": {
        return lintComponentRules(node);
      }
      default: {
        // do nothing
      }
    }
  }

  function checkEffects(node, errors) {
    if (node.effects.length) {
      if (node.effectStyleId === "") {
        const effectsArray = [];

        node.effects.forEach(effect => {
          let effectsObject = {
            type: "",
            radius: "",
            offsetX: "",
            offsetY: "",
            fill: "",
            value: ""
          };

          // All effects have a radius.
          effectsObject.radius = effect.radius;

          if (effect.type === "DROP_SHADOW") {
            effectsObject.type = "Drop Shadow";
          } else if (effect.type === "INNER_SHADOW") {
            effectsObject.type = "Inner Shadow";
          } else if (effect.type === "LAYER_BLUR") {
            effectsObject.type = "Layer Blur";
          } else {
            effectsObject.type = "Background Blur";
          }

          if (effect.color) {
            let effectsFill = convertColor(effect.color);
            effectsObject.fill = RGBToHex(
              effectsFill.r,
              effectsFill.g,
              effectsFill.b
            );
            effectsObject.offsetX = effect.offset.x;
            effectsObject.offsetY = effect.offset.y;
            effectsObject.value = `${effectsObject.type} ${effectsObject.fill} ${effectsObject.radius}px X: ${effectsObject.offsetX}, Y: ${effectsObject.offsetY}`;
          } else {
            effectsObject.value = `${effectsObject.type} ${effectsObject.radius}px`;
          }

          effectsArray.unshift(effectsObject);
        });

        let currentStyle = effectsArray[0].value;

        return errors.push(
          createErrorObject(
            node,
            "effects",
            "Missing effects style",
            currentStyle
          )
        );
      } else {
        return;
      }
    }
  }

  function checkFills(node, errors) {
    if (node.fills.length) {
      if (node.fillStyleId === "" && node.fills[0].type !== "IMAGE") {
        // We may need an array to loop through fill types.
        return errors.push(
          createErrorObject(
            node,
            "fill",
            "Missing fill style",
            determineFill(node.fills)
          )
        );
      } else {
        return;
      }
    }
  }

  function checkStrokes(node, errors) {
    if (node.strokes.length) {
      if (node.strokeStyleId === "") {
        let strokeObject = {
          strokeWeight: "",
          strokeAlign: "",
          strokeFills: []
        };

        strokeObject.strokeWeight = node.strokeWeight;
        strokeObject.strokeAlign = node.strokeAlign;
        strokeObject.strokeFills = determineFill(node.strokes);

        let currentStyle = `${strokeObject.strokeFills} / ${strokeObject.strokeWeight} / ${strokeObject.strokeAlign}`;

        return errors.push(
          createErrorObject(
            node,
            "stroke",
            "Missing stroke style",
            currentStyle
          )
        );
      } else {
        return;
      }
    }
  }

  function checkType(node, errors) {
    if (node.textStyleId === "") {
      let textObject = {
        font: "",
        fontStyle: "",
        fontSize: "",
        lineHeight: {}
      };

      textObject.font = node.fontName.family;
      textObject.fontStyle = node.fontName.style;
      textObject.fontSize = node.fontSize;
      textObject.lineHeight = node.lineHeight.value;

      let currentStyle = `${textObject.font} ${textObject.fontStyle} / ${textObject.fontSize} (${textObject.lineHeight} line-height)`;

      return errors.push(
        createErrorObject(node, "text", "Missing text style", currentStyle)
      );
    } else {
      return;
    }
  }

  function checkRadius(node, errors) {
    let cornerType = node.cornerRadius;
    const radiusValues = [0, 2, 4, 8, 16];

    // If the radius isn't even on all sides, check each corner.
    if (typeof cornerType === "symbol") {
      if (radiusValues.indexOf(node.topLeftRadius) === -1) {
        return errors.push(
          createErrorObject(
            node,
            "radius",
            "Incorrect Top Left Radius",
            node.topRightRadius
          )
        );
      } else if (radiusValues.indexOf(node.topRightRadius) === -1) {
        return errors.push(
          createErrorObject(
            node,
            "radius",
            "Incorrect top right radius",
            node.topRightRadius
          )
        );
      } else if (radiusValues.indexOf(node.bottomLeftRadius) === -1) {
        return errors.push(
          createErrorObject(
            node,
            "radius",
            "Incorrect bottom left radius",
            node.bottomLeftRadius
          )
        );
      } else if (radiusValues.indexOf(node.bottomRightRadius) === -1) {
        return errors.push(
          createErrorObject(
            node,
            "radius",
            "Incorrect bottom right radius",
            node.bottomRightRadius
          )
        );
      } else {
        return;
      }
    } else {
      if (radiusValues.indexOf(node.cornerRadius) === -1) {
        return errors.push(
          createErrorObject(
            node,
            "radius",
            "Incorrect border radius",
            node.cornerRadius
          )
        );
      } else {
        return;
      }
    }
  }

  // Generic function for creating an error object to pass to the app.
  function createErrorObject(node, type, message, value?) {
    let error = {
      message: "",
      type: "",
      node: "",
      value: ""
    };

    error.message = message;
    error.type = type;
    error.node = node;

    if (value !== undefined) {
      error.value = value;
    }

    return error;
  }

  function determineFill(fills) {
    let fillValues = [];

    fills.forEach(fill => {
      if (fill.type === "SOLID") {
        let rgbObj = convertColor(fill.color);
        fillValues.push(RGBToHex(rgbObj.r, rgbObj.g, rgbObj.b));
      } else if (fill.type === "IMAGE") {
        fillValues.push("Image - " + fill.imageHash);
      } else {
        const gradientValues = [];
        fill.gradientStops.forEach(gradientStops => {
          let gradientColorObject = convertColor(gradientStops.color);
          gradientValues.push(
            RGBToHex(
              gradientColorObject.r,
              gradientColorObject.g,
              gradientColorObject.b
            )
          );
        });
        let gradientValueString = gradientValues.toString();
        fillValues.push(`${fill.type} ${gradientValueString}`);
      }
    });

    return fillValues[0];
  }

  function lintComponentRules(node) {
    let errors = [];

    if (node.remote === false) {
      errors.push(
        createErrorObject(node, "component", "Component isn't from library")
      );
    }

    return errors;
  }

  function lintTextRules(node) {
    let errors = [];

    checkType(node, errors);
    checkFills(node, errors);
    checkEffects(node, errors);
    checkStrokes(node, errors);

    return errors;
  }

  function lintShapeRules(node) {
    let errors = [];

    checkFills(node, errors);
    checkRadius(node, errors);
    checkStrokes(node, errors);
    checkEffects(node, errors);

    return errors;
  }
};

// Utility functions for color conversion.
const convertColor = color => {
  const colorObj = color;
  const figmaColor = {};

  Object.entries(colorObj).forEach(cf => {
    const [key, value] = cf;

    if (["r", "g", "b"].includes(key)) {
      figmaColor[key] = (value * 255).toFixed(0);
    }
    if (key === "a") {
      figmaColor[key] = value;
    }
  });
  return figmaColor;
};

function RGBToHex(r, g, b) {
  r = Number(r).toString(16);
  g = Number(g).toString(16);
  b = Number(b).toString(16);

  if (r.length == 1) r = "0" + r;
  if (g.length == 1) g = "0" + g;
  if (b.length == 1) b = "0" + b;

  return "#" + r + g + b;
}

function RGBAToHexA(r, g, b, a) {
  r = Number(r).toString(16);
  g = Number(g).toString(16);
  b = Number(b).toString(16);
  a = Math.round(a * 255).toString(16);

  if (r.length == 1) r = "0" + r;
  if (g.length == 1) g = "0" + g;
  if (b.length == 1) b = "0" + b;
  if (a.length == 1) a = "0" + a;

  return "#" + r + g + b + a;
}
