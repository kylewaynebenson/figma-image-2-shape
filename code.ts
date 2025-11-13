// Image to Shape Plugin for Figma - Recreates images using Figma primitives

// Updated interface for shape-based mosaic
interface MosaicConfig {
  shapeSize: number; // Size of each shape in pixels
  tileSizeVariation: string; // "1x", "2x", or "4x"
  shapeType: string; // "circle" or "square"
  imageTransparencyIsWhite: boolean;
  imageDuotone: boolean; // Limit to black and white
  colorLimit: number; // Number of colors to limit to
  colorSet: string; // "BW", "CMYK", "RGB", or "Sampled"
  groupColors: boolean; // Group shapes with matching colors in unions
  tileSizeBase?: number;
  duotoneColors?: { dark: { r: number, g: number, b: number }, light: { r: number, g: number, b: number } };
  limitedPalette?: Array<{ r: number, g: number, b: number }>;
}

// Updated data structure for cell data
interface CellData {
  brightness: number;
  color: { r: number, g: number, b: number };
  transparencyRatio: number;
}

// Main plugin code
figma.showUI(__html__, { width: 240, height: 350 });

// Update the getImageData function to use shapeSize
async function getImageData(
  node: SceneNode,
  config: MosaicConfig
): Promise<CellData[][]> {
  // Export the image as PNG
  let bytes: Uint8Array;
  try {
    bytes = await node.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 1 }
    });
  } catch (error) {
    console.error('Failed to export image:', error);
    // Calculate grid size based on shapeSize (in pixels)
    const gridWidth = Math.round(node.width / config.shapeSize);
    const gridHeight = Math.round(node.height / config.shapeSize);
    // Create a fallback data map with default values
    const result: CellData[][] = [];
    for (let y = 0; y < gridHeight; y++) {
      result[y] = [];
      for (let x = 0; x < gridWidth; x++) {
        const relativeX = x / gridWidth;
        const relativeY = y / gridHeight;
        // Create a simple gradient fallback
        result[y][x] = {
          brightness: 0.3 + relativeX * 0.4 + relativeY * 0.3,
          color: { 
            r: 0.3 + relativeX * 0.7, 
            g: 0.3 + relativeY * 0.7, 
            b: 0.5 
          },
          transparencyRatio: 0
        };
      }
    }
    return result;
  }
  
  // If duotone mode, refine the shape size using user input as a hint
  if (config.imageDuotone) {
    const userHintSize = config.shapeSize; // User's input
    
    // Quick refinement: just calculate exact size from node dimensions
    // Send bytes to UI to get pixel dimensions quickly
    const pixelDimensions = await new Promise<{width: number, height: number}>((resolve) => {
      const handler = (msg: any) => {
        if (msg.type === 'pixel-dimensions-result') {
          figma.ui.off('message', handler);
          resolve({ width: msg.pixelWidth, height: msg.pixelHeight });
        }
      };
      
      figma.ui.on('message', handler);
      
      figma.ui.postMessage({
        type: 'get-pixel-dimensions',
        bytes
      });
      
      // Timeout with fallback
      setTimeout(() => {
        figma.ui.off('message', handler);
        // Fallback: use user's hint to calculate grid
        const targetColumns = Math.round(node.width / userHintSize);
        resolve({ width: targetColumns, height: Math.round(node.height / userHintSize) });
      }, 1000);
    });
    
    // Calculate exact size
    const exactSize = node.width / pixelDimensions.width;
    
    // If user's hint is close (within 20%), use exact. Otherwise use hint-based grid.
    let refinedSize;
    if (Math.abs(exactSize - userHintSize) / userHintSize < 0.2) {
      refinedSize = exactSize;
    } else {
      const targetColumns = Math.round(node.width / userHintSize);
      refinedSize = node.width / targetColumns;
    }
    
    if (Math.abs(refinedSize - userHintSize) > 0.1) {
      figma.notify(`Refined: ${refinedSize.toFixed(3)}px (from ${userHintSize}px)`);
    }
    config.shapeSize = refinedSize;
    console.log(`Duotone: refined shape size to ${config.shapeSize.toFixed(3)}px`);
  }
  
  // Calculate grid size based on shapeSize (in pixels)
  const gridWidth = Math.round(node.width / config.shapeSize);
  const gridHeight = Math.round(node.height / config.shapeSize);
  
  console.log(`Grid size: ${gridWidth}x${gridHeight} (${gridWidth * gridHeight} total cells)`);
  
  // Sanity check for very large grids
  if (gridWidth * gridHeight > 50000) {
    figma.notify(`Warning: Grid is very large (${gridWidth}x${gridHeight}). This may take a while...`);
  }
  
  // Process the image data in UI context
  figma.ui.postMessage({
    type: 'process-image',
    bytes,
    gridSize: { width: gridWidth, height: gridHeight },
    imageTransparencyIsWhite: config.imageTransparencyIsWhite
  });
  
  console.log(`Sent image to UI for processing with grid size ${gridWidth}x${gridHeight}`);
  
  // Return a Promise that will resolve when UI sends back the result
  return new Promise((resolve) => {
    const handler = (msg: any) => {
      if (msg.type === 'image-data-result' && msg.dataMap) {
        console.log("Received image data from UI");
        figma.ui.off('message', handler);
        resolve(msg.dataMap);
      }
    };
    
    figma.ui.on('message', handler);
    
    // Add timeout for fallback
    setTimeout(() => {
      console.log("Timeout waiting for image data");
      figma.ui.off('message', handler);
      
      // Create a fallback data map
      const result: CellData[][] = [];
      for (let y = 0; y < gridHeight; y++) {
        result[y] = [];
        for (let x = 0; x < gridWidth; x++) {
          const relativeX = x / gridWidth;
          const relativeY = y / gridHeight;
          result[y][x] = {
            brightness: 0.3 + relativeX * 0.4 + relativeY * 0.3,
            color: { 
              r: 0.3 + relativeX * 0.7, 
              g: 0.3 + relativeY * 0.7, 
              b: 0.5 
            },
            transparencyRatio: 0
          };
        }
      }
      resolve(result);
    }, 10000);
  });
}

// Helper function to extract limited color palette from image data
function extractColorPalette(imageData: CellData[][], maxColors: number): Array<{ r: number, g: number, b: number }> {
  // Collect all unique colors with their frequencies
  const colorMap = new Map<string, { color: { r: number, g: number, b: number }, count: number }>();
  
  for (let y = 0; y < imageData.length; y++) {
    for (let x = 0; x < imageData[0].length; x++) {
      const cell = imageData[y][x];
      // Round colors to reduce precision and group similar colors
      const r = Math.round(cell.color.r * 20) / 20;
      const g = Math.round(cell.color.g * 20) / 20;
      const b = Math.round(cell.color.b * 20) / 20;
      const key = `${r},${g},${b}`;
      
      if (colorMap.has(key)) {
        colorMap.get(key)!.count++;
      } else {
        colorMap.set(key, { 
          color: { r, g, b }, 
          count: 1
        });
      }
    }
  }
  
  // Sort colors by frequency and take top N
  const sortedColors = Array.from(colorMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, maxColors)
    .map(entry => entry.color);
  
  return sortedColors;
}

// Helper function to sample extreme colors from RAW image bytes (for variety)
async function sampleExtremeColors(bytes: Uint8Array, maxColors: number): Promise<Array<{ r: number, g: number, b: number }>> {
  // Send to UI to sample from raw pixels
  return new Promise((resolve) => {
    const handler = (msg: any) => {
      if (msg.type === 'sampled-colors-result') {
        figma.ui.off('message', handler);
        resolve(msg.colors);
      }
    };
    
    figma.ui.on('message', handler);
    
    figma.ui.postMessage({
      type: 'sample-extreme-colors',
      bytes,
      maxColors
    });
  });
}

// Helper function to get preset color palettes
function getPresetPalette(paletteType: string, colorLimit: number): Array<{ r: number, g: number, b: number }> {
  if (paletteType === 'BW') {
    return [
      { r: 0, g: 0, b: 0 },   // Black
      { r: 1, g: 1, b: 1 }    // White
    ];
  } else if (paletteType === 'CMYK') {
    const base = [
      { r: 0, g: 1, b: 1 },   // Cyan
      { r: 1, g: 0, b: 1 },   // Magenta
      { r: 1, g: 1, b: 0 },   // Yellow
      { r: 0, g: 0, b: 0 }    // Black (Key)
    ];
    // Pad with white if needed
    while (base.length < colorLimit) {
      base.push({ r: 1, g: 1, b: 1 });
    }
    return base.slice(0, colorLimit);
  } else if (paletteType === 'RGB') {
    const base = [
      { r: 1, g: 0, b: 0 },   // Red
      { r: 0, g: 1, b: 0 },   // Green
      { r: 0, g: 0, b: 1 },   // Blue
      { r: 0, g: 0, b: 0 },   // Black
      { r: 1, g: 1, b: 1 }    // White
    ];
    // Pad with grays if needed
    while (base.length < colorLimit) {
      const gray = base.length / (colorLimit + 1);
      base.push({ r: gray, g: gray, b: gray });
    }
    return base.slice(0, colorLimit);
  }
  
  // Default fallback
  return [{ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }];
}

// Helper function to find closest color in palette
function findClosestColor(color: { r: number, g: number, b: number }, palette: Array<{ r: number, g: number, b: number }>): { r: number, g: number, b: number } {
  let closestColor = palette[0];
  let minDistance = Infinity;
  
  for (const paletteColor of palette) {
    const distance = Math.sqrt(
      Math.pow(color.r - paletteColor.r, 2) +
      Math.pow(color.g - paletteColor.g, 2) +
      Math.pow(color.b - paletteColor.b, 2)
    );
    
    if (distance < minDistance) {
      minDistance = distance;
      closestColor = paletteColor;
    }
  }
  
  return closestColor;
}

// Helper function to get max tile size from variation setting
function getMaxTileSize(variation: string): number {
  if (variation === "1x") return 1;
  if (variation === "2x") return 2;
  if (variation === "4x") return 4;
  return 1; // default
}

// Helper function to determine appropriate tile size for a region
function determineTileSizeByContent(
  imageData: CellData[][], 
  startX: number, 
  startY: number, 
  maxTileSize: number
): { size: number, averageBrightness: number, averageColor: {r: number, g: number, b: number} } {
  // Default to 1x1
  let size = 1;
  
  // If we don't allow larger tiles, return 1x1
  if (maxTileSize <= 1 || startY >= imageData.length || startX >= imageData[0].length) {
    const cell = imageData[startY][startX];
    return { 
      size: 1, 
      averageBrightness: cell.brightness,
      averageColor: cell.color
    };
  }
  
  // Check if we can create a 2x2 tile
  if (maxTileSize >= 2 && 
      startX + 1 < imageData[0].length && 
      startY + 1 < imageData.length) {
    
    // Get the 4 cells that would form a 2x2 tile
    const topLeft = imageData[startY][startX];
    const topRight = imageData[startY][startX + 1];
    const bottomLeft = imageData[startY + 1][startX];
    const bottomRight = imageData[startY + 1][startX + 1];
    
    // Calculate the brightness variance
    const brightnesses = [
      topLeft.brightness,
      topRight.brightness,
      bottomLeft.brightness,
      bottomRight.brightness
    ];
    
    const avgBrightness = brightnesses.reduce((sum, b) => sum + b, 0) / 4;
    
    // Calculate max deviation from average brightness
    const maxBrightnessDev = Math.max(
      ...brightnesses.map(b => Math.abs(b - avgBrightness))
    );
    
    // Calculate color variance
    const avgColor = {
      r: (topLeft.color.r + topRight.color.r + bottomLeft.color.r + bottomRight.color.r) / 4,
      g: (topLeft.color.g + topRight.color.g + bottomLeft.color.g + bottomRight.color.g) / 4,
      b: (topLeft.color.b + topRight.color.b + bottomLeft.color.b + bottomRight.color.b) / 4
    };
    
    const colorDevs = [
      Math.sqrt(
        Math.pow(topLeft.color.r - avgColor.r, 2) +
        Math.pow(topLeft.color.g - avgColor.g, 2) +
        Math.pow(topLeft.color.b - avgColor.b, 2)
      ),
      Math.sqrt(
        Math.pow(topRight.color.r - avgColor.r, 2) +
        Math.pow(topRight.color.g - avgColor.g, 2) +
        Math.pow(topRight.color.b - avgColor.b, 2)
      ),
      Math.sqrt(
        Math.pow(bottomLeft.color.r - avgColor.r, 2) +
        Math.pow(bottomLeft.color.g - avgColor.g, 2) +
        Math.pow(bottomLeft.color.b - avgColor.b, 2)
      ),
      Math.sqrt(
        Math.pow(bottomRight.color.r - avgColor.r, 2) +
        Math.pow(bottomRight.color.g - avgColor.g, 2) +
        Math.pow(bottomRight.color.b - avgColor.b, 2)
      )
    ];
    
    const maxColorDev = Math.max(...colorDevs);
    
    // If the region is similar enough, use a 2x2 tile
    const BRIGHTNESS_THRESHOLD = 0.1; // Max allowed brightness difference
    const COLOR_THRESHOLD = 0.15;    // Max allowed color difference
    
    if (maxBrightnessDev < BRIGHTNESS_THRESHOLD && maxColorDev < COLOR_THRESHOLD) {
      size = 2;
      
      // Check if we can create a 4x4 tile
      if (maxTileSize >= 4 && 
          startX + 3 < imageData[0].length && 
          startY + 3 < imageData.length) {
        
        // Check if the 4x4 region is consistent
        let consistent = true;
        let totalBrightness = 0;
        let totalR = 0, totalG = 0, totalB = 0;
        let count = 0;
        
        for (let y = startY; y < startY + 4; y++) {
          for (let x = startX; x < startX + 4; x++) {
            if (y >= imageData.length || x >= imageData[0].length) {
              consistent = false;
              break;
            }
            const cell = imageData[y][x];
            totalBrightness += cell.brightness;
            totalR += cell.color.r;
            totalG += cell.color.g;
            totalB += cell.color.b;
            count++;
          }
          if (!consistent) break;
        }
        
        if (consistent) {
          const avg4x4Brightness = totalBrightness / count;
          const avg4x4Color = {
            r: totalR / count,
            g: totalG / count,
            b: totalB / count
          };
          
          // Check all cells for consistency with the 4x4 average
          let isConsistent4x4 = true;
          for (let y = startY; y < startY + 4 && isConsistent4x4; y++) {
            for (let x = startX; x < startX + 4 && isConsistent4x4; x++) {
              const cell = imageData[y][x];
              const brightnessDiff = Math.abs(cell.brightness - avg4x4Brightness);
              const colorDiff = Math.sqrt(
                Math.pow(cell.color.r - avg4x4Color.r, 2) +
                Math.pow(cell.color.g - avg4x4Color.g, 2) +
                Math.pow(cell.color.b - avg4x4Color.b, 2)
              );
              
              if (brightnessDiff > BRIGHTNESS_THRESHOLD || colorDiff > COLOR_THRESHOLD) {
                isConsistent4x4 = false;
              }
            }
          }
          
          if (isConsistent4x4) {
            size = 4;
            return { 
              size: 4, 
              averageBrightness: avg4x4Brightness,
              averageColor: avg4x4Color
            };
          }
        }
      }
      
      return { 
        size: 2, 
        averageBrightness: avgBrightness,
        averageColor: avgColor
      };
    }
  }
  
  // Return 1x1 if we can't use a larger size
  const cell = imageData[startY][startX];
  return { 
    size: 1, 
    averageBrightness: cell.brightness,
    averageColor: cell.color
  };
}

// Helper function to create a shape (circle or square) with a fill color
function createShape(
  shapeType: string, 
  x: number, 
  y: number, 
  size: number, 
  color: { r: number, g: number, b: number },
  brightness: number,
  config: MosaicConfig
): { shape: SceneNode, finalColor: { r: number, g: number, b: number } } {
  let shape: SceneNode;
  
  if (shapeType === 'circle') {
    const ellipse = figma.createEllipse();
    ellipse.resize(size, size);
    shape = ellipse;
  } else {
    // Default to square
    const rectangle = figma.createRectangle();
    rectangle.resize(size, size);
    shape = rectangle;
  }
  
  shape.x = x;
  shape.y = y;
  
  // Determine fill color based on color limiting mode
  let fillColor = color;
  
  if (config.imageDuotone && config.duotoneColors) {
    // Duotone mode: Determine if the actual color is closer to black or white
    // Calculate distance to black (0,0,0) and white (1,1,1)
    const distToBlack = Math.sqrt(
      Math.pow(color.r, 2) + 
      Math.pow(color.g, 2) + 
      Math.pow(color.b, 2)
    );
    const distToWhite = Math.sqrt(
      Math.pow(color.r - 1, 2) + 
      Math.pow(color.g - 1, 2) + 
      Math.pow(color.b - 1, 2)
    );
    
    // Use whichever is closer
    fillColor = distToBlack < distToWhite ? config.duotoneColors.dark : config.duotoneColors.light;
  } else if (config.limitedPalette && config.limitedPalette.length > 0) {
    // Color limiting mode: Find closest color in palette
    fillColor = findClosestColor(color, config.limitedPalette);
  }
  
  // Set the fill color
  shape.fills = [{
    type: 'SOLID',
    color: { r: fillColor.r, g: fillColor.g, b: fillColor.b }
  }];
  
  return { shape, finalColor: fillColor };
}

// Main function to create the mosaic using shapes
async function createMosaic(
  selectedImage: SceneNode, 
  config: MosaicConfig, 
  imageData: CellData[][]
) {
  try {
    console.log(`Creating ${config.shapeType} mosaic`);
    
    // Create a frame to hold the mosaic
    const mosaicGroup = figma.createFrame();
    mosaicGroup.name = `${config.shapeType.charAt(0).toUpperCase() + config.shapeType.slice(1)} Mosaic`;
    
    // Calculate dimensions based on original image size
    const width = selectedImage.width;
    const height = selectedImage.height;
    mosaicGroup.resize(width, height);
    
    // Position the frame next to the original image
    mosaicGroup.x = selectedImage.x + selectedImage.width + 20;
    mosaicGroup.y = selectedImage.y;
    
    // Add to current page
    figma.currentPage.appendChild(mosaicGroup);
    console.log("Created mosaic frame");
    
    // Calculate grid based on shape size in pixels
    const xTileCount = Math.round(width / config.shapeSize);
    const yTileCount = Math.round(height / config.shapeSize);
    
    if (xTileCount <= 0 || yTileCount <= 0) {
      figma.notify(`Unable to create mosaic: invalid column count: ${xTileCount}`);
      mosaicGroup.remove();
      return;
    }
    
    // Calculate the tile size based on the desired column count
    const tileBaseSize = width / xTileCount;
    
    // Add tileBaseSize to config for reference
    config.tileSizeBase = tileBaseSize;
    
    console.log(`Creating ${xTileCount}x${yTileCount} mosaic grid with size variation: ${config.tileSizeVariation}`);
    console.log(`Base tile size: ${tileBaseSize}px`);
    
    // Get maximum tile size from config
    const maxTileSize = getMaxTileSize(config.tileSizeVariation);
    
    // Count tiles for progress
    let completedTiles = 0;
    const totalTiles = xTileCount * yTileCount;
    
    // Verify data dimensions
    if (imageData.length === 0 || imageData[0].length === 0) {
      console.error("Image data is empty!");
      figma.notify("Error: Image data is invalid");
      mosaicGroup.remove();
      return;
    }
    
    // Set up color limiting based on mode
    if (config.imageDuotone) {
      // Duotone mode: use pure black and white
      config.duotoneColors = {
        dark: { r: 0, g: 0, b: 0 },   // Pure black
        light: { r: 1, g: 1, b: 1 }   // Pure white
      };
      console.log(`Duotone mode: Using pure black and white`);
    } else if (config.colorLimit && config.colorLimit > 0 && config.colorLimit < 256) {
      // Extract limited color palette based on colorSet
      if (config.colorSet === 'Sampled') {
        // Sample extreme colors from the raw image
        const bytes = await selectedImage.exportAsync({
          format: 'PNG',
          constraint: { type: 'SCALE', value: 1 }
        });
        config.limitedPalette = await sampleExtremeColors(bytes, config.colorLimit);
        console.log(`Color limiting: Sampled ${config.limitedPalette.length} extreme colors from image`);
      } else if (config.colorSet === 'BW' || config.colorSet === 'CMYK' || config.colorSet === 'RGB') {
        // Use preset palette
        config.limitedPalette = getPresetPalette(config.colorSet, config.colorLimit);
        console.log(`Color limiting: Using ${config.colorSet} preset with ${config.limitedPalette.length} colors`);
      } else {
        // Default: extract most frequent colors
        config.limitedPalette = extractColorPalette(imageData, config.colorLimit);
        console.log(`Color limiting: Using ${config.limitedPalette.length} most frequent colors`);
      }
    }
    
    // Create a grid to track which cells are already filled
    const occupiedGrid: boolean[][] = [];
    for (let y = 0; y < yTileCount; y++) {
      occupiedGrid[y] = [];
      for (let x = 0; x < xTileCount; x++) {
        occupiedGrid[y][x] = false;
      }
    }
    
    // If grouping by color, create a map to store shapes by color
    const colorGroups = new Map<string, SceneNode[]>();
    
    // Create shapes for each grid position
    for (let y = 0; y < yTileCount; y++) {
      for (let x = 0; x < xTileCount; x++) {
        // Skip if this cell is already occupied
        if (occupiedGrid[y][x]) {
          continue;
        }
        
        try {
          // Map grid position to image data position
          const mapX = Math.min(imageData[0].length - 1, Math.floor(x * imageData[0].length / xTileCount));
          const mapY = Math.min(imageData.length - 1, Math.floor(y * imageData.length / yTileCount));
          
          // Determine tile size and get average color for the region
          const tileInfo = determineTileSizeByContent(
            imageData,
            mapX,
            mapY,
            maxTileSize
          );
          
          const size = tileInfo.size;
          const color = tileInfo.averageColor;
          const brightness = tileInfo.averageBrightness;
          
          // Create the shape
          const result = createShape(
            config.shapeType,
            x * tileBaseSize,
            y * tileBaseSize,
            size * tileBaseSize,
            color,
            brightness,
            config
          );
          
          const shape = result.shape;
          const finalColor = result.finalColor;
          
          // If grouping by color, add to color group map using the FINAL color
          if (config.groupColors) {
            const colorKey = `${Math.round(finalColor.r * 255)},${Math.round(finalColor.g * 255)},${Math.round(finalColor.b * 255)}`;
            if (!colorGroups.has(colorKey)) {
              colorGroups.set(colorKey, []);
            }
            colorGroups.get(colorKey)!.push(shape);
          } else {
            // Add directly to mosaic group
            mosaicGroup.appendChild(shape);
          }
          
          // Mark cells as occupied based on the tile size
          for (let dy = 0; dy < size && (y + dy) < yTileCount; dy++) {
            for (let dx = 0; dx < size && (x + dx) < xTileCount; dx++) {
              occupiedGrid[y + dy][x + dx] = true;
            }
          }
          
          // Count tiles completed (count by area covered)
          completedTiles += size * size;
        } catch (error) {
          console.error(`Error processing tile at (${x}, ${y}):`, error);
        }
      }
    }
    
    // If grouping by color, create union groups
    if (config.groupColors) {
      console.log(`Creating ${colorGroups.size} color groups...`);
      figma.notify(`Creating ${colorGroups.size} color groups...`);
      
      let groupIndex = 0;
      for (const [colorKey, shapes] of colorGroups.entries()) {
        if (shapes.length === 0) continue;
        
        groupIndex++;
        
        // Add all shapes to the frame first
        for (const shape of shapes) {
          mosaicGroup.appendChild(shape);
        }
        
        // Create a union for this color (this can be slow for many shapes)
        try {
          const unionGroup = figma.union(shapes, mosaicGroup);
          unionGroup.name = `Color ${colorKey}`;
          console.log(`Created union ${groupIndex}/${colorGroups.size}: ${shapes.length} shapes`);
        } catch (error) {
          console.error(`Error creating union for color ${colorKey}:`, error);
        }
      }
      
      figma.notify(`Created ${colorGroups.size} color groups.`);
    } else {
      figma.notify(`Mosaic created with ${mosaicGroup.children.length} shapes.`);
    }
    
  } catch (error) {
    console.error("Error creating mosaic:", error);
    figma.notify("Error creating mosaic. See console for details.");
  }
}

// Function to detect optimal shape size for an image
async function detectShapeSize(node: SceneNode, imageTransparencyIsWhite: boolean): Promise<number> {
  // Export image at small scale for analysis
  const bytes = await node.exportAsync({
    format: 'PNG',
    constraint: { type: 'SCALE', value: 0.5 }
  });
  
  // Analyze the image to find optimal size
  // For dithered images, we want to find the size of the repeating pattern
  // For regular images, we want a size that balances detail and performance
  
  // Send to UI for analysis
  figma.ui.postMessage({
    type: 'analyze-image-pattern',
    bytes,
    imageWidth: node.width,
    imageHeight: node.height,
    imageTransparencyIsWhite
  });
  
  // Wait for response
  return new Promise((resolve) => {
    const handler = (msg: any) => {
      if (msg.type === 'pattern-analysis-result') {
        figma.ui.off('message', handler);
        resolve(msg.optimalSize);
      }
    };
    
    figma.ui.on('message', handler);
    
    // Timeout with default
    setTimeout(() => {
      figma.ui.off('message', handler);
      // Default: aim for ~20-50 shapes depending on image size
      const defaultSize = Math.max(8, Math.min(32, Math.round(Math.min(node.width, node.height) / 30)));
      resolve(defaultSize);
    }, 5000);
  });
}

// Update the main message handler
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'detect-shape-size') {
    const selection = figma.currentPage.selection;
    
    if (selection.length === 0) {
      figma.notify('Please select an image first');
      return;
    }
    
    try {
      figma.notify('Analyzing image...');
      const optimalSize = await detectShapeSize(selection[0], msg.imageTransparencyIsWhite);
      
      // Send result back to UI
      figma.ui.postMessage({
        type: 'detected-shape-size',
        shapeSize: optimalSize
      });
      
      figma.notify(`Detected optimal shape size: ${optimalSize}px`);
    } catch (error) {
      console.error('Error detecting shape size:', error);
      figma.notify('Error detecting shape size');
    }
  }
  else if (msg.type === 'create-mosaic') {
    const config: MosaicConfig = msg.config;
    console.log('Received config:', config);

    // Get selected nodes
    const selection = figma.currentPage.selection;
    
    if (selection.length === 0) {
      figma.notify('Please select an image');
      return;
    }
    
    // If duotone mode is enabled, force optimal parameters
    if (config.imageDuotone) {
      // Force duotone-specific settings (will be auto-detected during image processing)
      config.tileSizeVariation = "1x"; // Uniform tiles for exact reproduction
      config.colorLimit = 2; // Only 2 colors
      console.log('Duotone mode: parameters will be auto-detected');
    } else {
      // Ensure shape size is at least 1 for non-duotone mode
      config.shapeSize = Math.max(1, config.shapeSize || 20);
    }
    
    console.log(`Creating ${config.shapeType} mosaic`);
    
    try {
      // Get image data using UI context processing with the column count grid
      console.log("Getting image data...");
      const imageData = await getImageData(selection[0], config);
      
      // Create the mosaic with the processed data
      console.log("Creating mosaic...");
      figma.notify("Creating mosaic...");
      await createMosaic(selection[0], config, imageData);
      
    } catch (error) {
      console.error('Error creating mosaic:', error);
      figma.notify('Error creating mosaic. See console for details.');
    }
  }
  
  // Handle image data result from UI
  else if (msg.type === 'image-data-result') {
    console.log('Received image data from UI (main handler)');
    // This will be handled by the Promise in getImageData
  }
};
